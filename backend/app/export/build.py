from __future__ import annotations

import json
from pathlib import Path

from app.core.context import AppContext
from app.db.models import Job
from mesh_ready_check import load_mesh


def export_assets(ctx: AppContext, job: Job, job_dir: Path) -> dict:
    out = job_dir / "export"
    out.mkdir(parents=True, exist_ok=True)
    files = {}
    for key, src in (
        ("raw_glb", Path(job.result["generation"]["mesh_path"])),
        ("repaired_glb", Path(job.result["repair"]["repaired_path"])),
    ):
        mesh, _ = load_mesh(src)
        path = out / f"{key.removesuffix('_glb')}.glb"
        mesh.export(path)
        files[key] = str(path)
    asset = {"asset_id": None, "mesh_url": ctx.storage.url(Path(files["repaired_glb"]))}
    (out / "asset.json").write_text(json.dumps(asset, indent=2), "utf-8")
    return {**files, "asset_path": str(out / "asset.json")}
