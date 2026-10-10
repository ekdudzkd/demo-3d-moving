from __future__ import annotations

from pathlib import Path

from mesh_ready_check import Thresholds, inspect_path


def inspect_file(path: Path, face_budget: int, target_size: float | None = None) -> dict:
    return inspect_path(
        path, Thresholds(face_budget=face_budget, target_size=target_size)
    ).to_dict()
