"""생성 결과 보고서 (화면 6, project-brief §20)."""

from __future__ import annotations

import json
from pathlib import Path

from app.core.context import AppContext
from app.db.models import Job, Mask, utcnow
from app.jobs.states import Outcome

from .failures import classify, mask_signals
from .silhouette import silhouette_scores

SCHEMA_VERSION = "1.0"
DISCLAIMER = "한 장의 이미지를 바탕으로 AI가 추정한 3D 모델입니다. 보이지 않는 부분은 실제 모습과 다를 수 있습니다."

DIFF_METRICS = [
    ("face_count", None),
    ("vertex_count", None),
    ("connected_components", "lower"),
    ("open_boundary_edges", "lower"),
    ("non_manifold_edges", "lower"),
    ("duplicate_vertices", "lower"),
    ("degenerate_faces", "lower"),
    ("centered", "true"),
    ("grounded", "true"),
    ("winding_consistent", "true"),
]


def outcome_of(inspect_report: dict) -> Outcome:
    if not inspect_report["is_usable"]:
        return Outcome.NOT_USABLE
    if inspect_report["warnings"]:
        return Outcome.USABLE_WITH_WARNINGS
    return Outcome.USABLE


def quality_diff(raw: dict, repaired: dict) -> list[dict]:
    rows = []
    for key, better in DIFF_METRICS:
        before, after = raw.get(key), repaired.get(key)
        if better == "lower":
            improved = after < before
        elif better == "true":
            improved = bool(after) and not bool(before)
        else:
            improved = None
        rows.append({"metric": key, "before": before, "after": after, "improved": improved})
    rows.append(
        {
            "metric": "warnings",
            "before": len(raw["warnings"]),
            "after": len(repaired["warnings"]),
            "improved": len(repaired["warnings"]) < len(raw["warnings"]),
        }
    )
    return rows


def stage_timings(job: Job) -> list[dict]:
    return [{"stage": e.stage, "elapsed_ms": e.elapsed_ms} for e in job.events if e.kind == "exit"]


def build_report(ctx: AppContext, job: Job, job_dir: Path) -> dict:
    r = job.result
    raw, repaired = r["inspect_raw"], r["repair"]["inspect_repaired"]
    gen = r["generation"]
    export = r["export"]
    mask = next((m for m in job.project.masks if m.version == job.mask_version), None)
    st = ctx.storage
    outcome = outcome_of(repaired)

    report = {
        "schema_version": SCHEMA_VERSION,
        "job_id": job.id,
        "project_id": job.project_id,
        "generated_at": utcnow().isoformat(),
        "disclaimer": DISCLAIMER,
        "outcome": outcome.value,
        "usable": outcome is not Outcome.NOT_USABLE,
        "model": {
            **r["model_info"],
            "options": gen["options"],
            "environment": r.get("environment"),
            "warnings": gen["warnings"],
        },
        "input": {
            "validation": job.project.validation,
            "mask": _mask_summary(mask),
            "preprocess": r["preprocess"],
        },
        "timings": {
            "stages": stage_timings(job),
            "generation_ms": gen["generation_time_ms"],
            "model_load_ms": gen["model_load_time_ms"],
            "peak_vram_mb": gen["peak_vram_mb"],
        },
        "quality": {"raw": raw, "repaired": repaired, "diff": quality_diff(raw, repaired)},
        "repair_steps": [
            {k: s[k] for k in ("name", "applied", "rolled_back", "reason", "elapsed_ms")}
            for s in r["repair"]["steps"]
        ],
        "signals": (signals := failure_signals(ctx, job)),
        "failure_types": classify(raw, repaired, export["asset"]["collider"], signals),
        "asset": {
            "asset_id": export["asset"]["asset_id"],
            "collision_type": export["asset"]["collision_type"],
        },
        "downloads": {
            "repaired_glb": st.url(Path(export["repaired_glb"])),
            "raw_glb": st.url(Path(export["raw_glb"])),
            "raw_mesh": st.url(Path(gen["mesh_path"])),
            "asset": st.url(Path(export["asset_path"])),
            "report": st.url(job_dir / "report.json"),
        },
    }
    (job_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), "utf-8")
    return report


def failure_signals(ctx: AppContext, job: Job) -> dict:
    """실패 분류용 신호: 정면 실루엣 비교, 확정 마스크 면적·테두리 접촉. 계산 실패는 빈 값."""
    import numpy as np
    from PIL import Image

    from app.segmentation.service import load_mask
    from mesh_ready_check import load_mesh

    signals: dict = {}
    try:
        mesh, _ = load_mesh(Path(job.result["export"]["repaired_glb"]))
        normalized = Path(job.result["preprocess"]["normalized"])
        alpha = np.asarray(Image.open(normalized))[..., 3] >= 128
        signals["silhouette"] = silhouette_scores(mesh, alpha)
    except Exception as exc:  # noqa: BLE001 — 신호가 없어도 보고서는 만든다
        signals["silhouette_error"] = f"{type(exc).__name__}: {exc}"[:200]
    try:
        signals.update(mask_signals(load_mask(ctx, job.project_id, job.mask_version)))
    except Exception as exc:  # noqa: BLE001
        signals["mask_error"] = f"{type(exc).__name__}: {exc}"[:200]
    return signals


def _mask_summary(mask: Mask | None) -> dict | None:
    if mask is None:
        return None
    return {
        "version": mask.version,
        "method": mask.method,
        "coverage": mask.coverage,
        "prompts": mask.prompts,
        "elapsed_ms": mask.elapsed_ms,
    }
