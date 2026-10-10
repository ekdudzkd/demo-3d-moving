from __future__ import annotations

import json
from pathlib import Path

from mesh_ready_check import load_mesh

from .inspect import inspect_file


def repair_file(raw_path: Path, out_dir: Path, face_budget: int) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    mesh, _ = load_mesh(raw_path)
    repaired_path = out_dir / "repaired.ply"
    mesh.export(repaired_path)
    report = inspect_file(repaired_path, face_budget)
    (out_dir / "inspect_repaired.json").write_text(json.dumps(report, indent=2), "utf-8")
    return {"repaired_path": str(repaired_path), "steps": [], "inspect_repaired": report}
