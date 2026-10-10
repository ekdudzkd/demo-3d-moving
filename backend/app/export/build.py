"""GLB 변환과 월드 자산(asset.json) 생성 (project-brief §14)."""

from __future__ import annotations

import json
from pathlib import Path

from app.core.context import AppContext
from app.core.errors import ErrorCode, PipelineError
from app.db.models import Job, new_id
from mesh_ready_check import load_mesh

from .collider import build_collider
from .glb import write_glb

SPAWN_HEIGHT = 1.0


def to_glb(src: Path, dst: Path) -> None:
    mesh, _ = load_mesh(src)
    if len(mesh.faces) == 0:
        raise PipelineError(ErrorCode.EXPORT_FAILED, f"빈 메시: {src.name}")
    write_glb(mesh, dst)


def export_assets(ctx: AppContext, job: Job, job_dir: Path, display_name: str) -> dict:
    out = job_dir / "export"
    out.mkdir(parents=True, exist_ok=True)
    raw_glb, repaired_glb = out / "raw.glb", out / "repaired.glb"
    try:
        to_glb(Path(job.result["generation"]["mesh_path"]), raw_glb)
        to_glb(Path(job.result["repair"]["repaired_path"]), repaired_glb)
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError(ErrorCode.EXPORT_FAILED, f"{type(exc).__name__}: {exc}") from exc

    # GLB를 다시 읽어 실제로 로드 가능한지 확인하고 그 메시로 충돌체를 만든다
    mesh, _ = load_mesh(repaired_glb)
    collider = build_collider(mesh)
    (out / "collider.json").write_text(json.dumps(collider, indent=2), "utf-8")

    asset_id = new_id("ast")
    lo, hi = mesh.bounds
    asset = {
        "asset_id": asset_id,
        "display_name": display_name,
        "mesh_url": ctx.storage.url(repaired_glb),
        "raw_mesh_url": ctx.storage.url(raw_glb),
        "scale": 1.0,
        "spawn_position": [0.0, SPAWN_HEIGHT, 0.0],
        "collision_type": collider["type"],
        "collider": collider,
        "interaction_type": "movable",
        "mass": 1.0,
        "bounds": [lo.round(5).tolist(), hi.round(5).tolist()],
        "up_axis": "Y",
        "units": "meters",
    }
    (out / "asset.json").write_text(json.dumps(asset, ensure_ascii=False, indent=2), "utf-8")
    return {
        "raw_glb": str(raw_glb),
        "repaired_glb": str(repaired_glb),
        "asset_path": str(out / "asset.json"),
        "asset": asset,
    }
