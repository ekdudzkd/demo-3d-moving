"""편집 버전 저장·적용 (D-027).

- 버전은 append-only. undo·revert도 "목적지 op를 복사한 새 버전"을 추가한다.
- 적용은 워커가 한다: v0(보정 메시) → op 합성 → QC(target_size=None) → GLB → 충돌체.
  repair는 다시 돌리지 않는다(normalize_scale이 크기 편집을 지운다).
- QC ERROR나 export 오류면 failed로 남기고 활성 버전은 그대로 둔다.
- asset마다 pending/running 버전은 최대 1개.
"""

from __future__ import annotations

import json
import time
import traceback
from pathlib import Path

import trimesh
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.context import AppContext
from app.core.errors import ErrorCode, PipelineError
from app.db.models import Asset, AssetVersion, Job, utcnow
from app.export.collider import build_collider
from app.export.glb import write_glb
from mesh_ready_check import Thresholds, inspect_mesh, load_mesh

from .compose import apply

ACTIVE = ("pending", "running")


class EditConflict(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def label_of(job: Job) -> str:
    return (job.options or {}).get("view_label", "front")


def v0_path(job: Job) -> Path:
    return Path(job.result["repair"]["repaired_path"])


def load_v0(job: Job) -> trimesh.Trimesh:
    mesh, _ = load_mesh(v0_path(job))
    return mesh


def edits_dir(ctx: AppContext, job: Job) -> Path:
    return ctx.storage.job_dir(job.project_id, job.id) / "edits"


def get_version(session: Session, asset_id: str, version: int) -> AssetVersion | None:
    return session.scalar(
        select(AssetVersion).where(
            AssetVersion.asset_id == asset_id, AssetVersion.version == version
        )
    )


def active_version(session: Session, asset: Asset) -> AssetVersion:
    v = get_version(session, asset.id, asset.data.get("active_version", 0))
    assert v is not None, f"활성 버전이 없음: {asset.id}"
    return v


def in_progress(session: Session, asset_id: str) -> AssetVersion | None:
    return session.scalar(
        select(AssetVersion).where(
            AssetVersion.asset_id == asset_id, AssetVersion.status.in_(ACTIVE)
        )
    )


# ---- 메시 만들기 -----------------------------------------------------------------


def materialize(ctx: AppContext, job: Job, ops: list[dict], name: str) -> dict:
    """op 리스트를 적용한 GLB·충돌체·QC를 만든다. 사용할 수 없으면 PipelineError."""
    out = edits_dir(ctx, job)
    out.mkdir(parents=True, exist_ok=True)
    mesh = apply(load_v0(job), ops)
    report = inspect_mesh(mesh, Thresholds(face_budget=ctx.settings.face_budget, target_size=None))
    qc = {
        "errors": sorted(c.code for c in report.errors),
        "warnings": sorted(c.code for c in report.warnings),
        "extents": report.extents,
        "face_count": report.face_count,
    }
    if report.errors:
        raise PipelineError(ErrorCode.MESH_UNUSABLE, f"QC 오류: {', '.join(qc['errors'])}")
    if ctx.settings.edit_fail == "export":
        raise PipelineError(ErrorCode.EXPORT_FAILED, "실패 주입(edit_fail=export)")
    glb = out / f"{name}.glb"
    try:
        write_glb(mesh, glb)
        loaded, _ = load_mesh(glb)  # 다시 읽어 실제로 로드 가능한지 확인
        collider = build_collider(loaded)
    except Exception as exc:
        raise PipelineError(ErrorCode.EXPORT_FAILED, f"{type(exc).__name__}: {exc}") from exc
    (out / f"{name}.collider.json").write_text(json.dumps(collider, indent=2), "utf-8")
    (out / f"{name}.json").write_text(json.dumps({"ops": ops, "qc": qc}, indent=2), "utf-8")
    lo, hi = loaded.bounds
    return {
        "glb_path": str(glb),
        "mesh_url": ctx.storage.url(glb),
        "collider": collider,
        "bounds": [lo.round(5).tolist(), hi.round(5).tolist()],
        "qc": qc,
    }


def _activate(asset: Asset, v: AssetVersion) -> None:
    r = v.result
    asset.data = {
        **asset.data,
        "active_version": v.version,
        "mesh_url": r["mesh_url"],
        "collider": r["collider"],
        "collision_type": r["collider"]["type"],
        "bounds": r["bounds"],
    }


def init_versions(ctx: AppContext, session: Session, job: Job, asset: Asset) -> AssetVersion:
    """export 직후 e0을 만든다. front면 보정 GLB를 그대로 쓰고, 아니면 라벨 회전본을 만든다."""
    label = label_of(job)
    ops = [{"op": "label", "label": label}]
    e0 = AssetVersion(
        asset_id=asset.id, version=0, status="ready", kind="base", ops=ops, intent={"label": label}
    )
    if label == "front":
        e0.result = {
            "mesh_url": asset.data["mesh_url"],
            "collider": asset.data["collider"],
            "bounds": asset.data["bounds"],
            "qc": {},
        }
    else:
        e0.result = materialize(ctx, job, ops, "e0")
    e0.finished_at = utcnow()
    session.add(e0)
    _activate(asset, e0)
    asset.data = {**asset.data, "view_label": label}
    session.flush()
    return e0


# ---- 버전 추가 -------------------------------------------------------------------


def _append(
    session: Session, asset: Asset, kind: str, ops: list[dict], prev: int | None, intent: dict
) -> AssetVersion:
    if busy := in_progress(session, asset.id):
        raise EditConflict("edit_in_progress", f"e{busy.version} 편집을 처리하는 중이에요.")
    last = session.scalar(
        select(func.max(AssetVersion.version)).where(AssetVersion.asset_id == asset.id)
    )
    v = AssetVersion(
        asset_id=asset.id,
        version=last + 1,
        status="pending",
        kind=kind,
        ops=ops,
        intent=intent,
        prev_state=prev,
    )
    session.add(v)
    session.flush()
    return v


def add_edit(session: Session, asset: Asset, new_ops: list[dict], intent: dict) -> AssetVersion:
    active = active_version(session, asset)
    return _append(session, asset, "edit", active.ops + new_ops, active.version, intent)


def add_undo(session: Session, asset: Asset) -> AssetVersion:
    if busy := in_progress(session, asset.id):
        raise EditConflict("edit_in_progress", f"e{busy.version} 편집을 처리하는 중이에요.")
    active = active_version(session, asset)
    if active.prev_state is None:
        raise EditConflict("nothing_to_undo", "더 되돌릴 편집이 없어요.")
    target = get_version(session, asset.id, active.prev_state)
    intent = {"undo_of": active.version, "to": target.version}
    return _append(session, asset, "undo", list(target.ops), target.prev_state, intent)


def add_revert(session: Session, asset: Asset, to_version: int) -> AssetVersion:
    target = get_version(session, asset.id, to_version)
    if target is None:
        raise LookupError(f"e{to_version} 버전이 없어요.")
    if target.status != "ready":
        raise EditConflict("not_ready", f"e{to_version}은 사용할 수 있는 버전이 아니에요.")
    active = active_version(session, asset)
    intent = {"revert_to": to_version}
    return _append(session, asset, "revert", list(target.ops), active.version, intent)


# ---- 워커 ------------------------------------------------------------------------


def claim_next_version(session: Session) -> int | None:
    candidate = session.scalar(
        select(AssetVersion.id)
        .where(AssetVersion.status == "pending")
        .order_by(AssetVersion.created_at, AssetVersion.id)
        .limit(1)
    )
    if candidate is None:
        return None
    claimed = session.execute(
        update(AssetVersion)
        .where(AssetVersion.id == candidate, AssetVersion.status == "pending")
        .values(status="running")
    )
    session.commit()
    return candidate if claimed.rowcount == 1 else None


def run_version(ctx: AppContext, version_id: int) -> str:
    with ctx.session() as session:
        v = session.get(AssetVersion, version_id)
        asset = session.get(Asset, v.asset_id)
        job = session.get(Job, asset.job_id)
        started = time.perf_counter()
        try:
            v.result = materialize(ctx, job, v.ops, f"e{v.version}")
        except PipelineError as exc:
            v.status = "failed"
            v.error = {
                "code": exc.code.value,
                "user_message": exc.user_message,
                "detail": exc.detail,
            }
        except Exception as exc:  # noqa: BLE001 - 어떤 오류든 버전 실패로 남긴다
            v.status = "failed"
            v.error = {
                "code": ErrorCode.INTERNAL.value,
                "user_message": "편집을 적용하지 못했어요.",
                "detail": f"{type(exc).__name__}: {exc}",
                "trace": traceback.format_exc(limit=5),
            }
        else:
            v.status = "ready"
            _activate(asset, v)
        v.result = {**v.result, "elapsed_ms": round((time.perf_counter() - started) * 1000)}
        v.finished_at = utcnow()
        session.commit()
        return v.status


def recover_stale_versions(session: Session) -> int:
    stale = session.scalars(select(AssetVersion).where(AssetVersion.status == "running")).all()
    for v in stale:
        v.status = "failed"
        v.error = {
            "code": ErrorCode.INTERNAL.value,
            "user_message": "편집 처리 중 서버가 재시작되었습니다. 다시 시도해 주세요.",
            "detail": "worker restarted",
        }
        v.finished_at = utcnow()
    session.commit()
    return len(stale)
