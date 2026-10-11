"""GPU 환경 점검 (3-1). `pytest -m gpu`로만 실행된다."""

import subprocess
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.gpu

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "check_gpu_env.py"


def test_gpu_env_check_passes():
    r = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_shim_marching_cubes_matches_torchmcubes_axis_order():
    torch = pytest.importorskip("torch")
    from app.generation import triposr_shims

    # x(마지막 축)로만 길쭉한 상자 → 정점 x 범위가 가장 넓어야 한다
    vol = torch.full((16, 16, 48), -1.0)
    vol[4:12, 4:12, 4:44] = 1.0
    verts, faces = triposr_shims._marching_cubes(vol, 0.0)
    span = verts.max(0).values - verts.min(0).values
    assert len(faces) > 0
    assert span[0] > span[1] * 3 and span[0] > span[2] * 3
