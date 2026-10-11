"""TripoSR 실제 생성 (3-3). `pytest -m gpu`로만 실행. 첫 실행 때 가중치(약 1.7GB)를 받는다."""

import os
from pathlib import Path

import numpy as np
import pytest
import trimesh
from PIL import Image

from app.core.config import Settings
from app.generation.base import GenerationOptions
from app.preprocess.normalize import PreprocessOptions, normalize
from app.segmentation.base import Prompts
from app.segmentation.grabcut import GrabCutSegmenter
from app.segmentation.postprocess import refine_mask

pytestmark = pytest.mark.gpu

ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="module")
def adapter():
    pytest.importorskip("torch")
    from app.generation.triposr import TripoSRAdapter

    cache = os.environ.get("MODEL_CACHE_DIR", str(ROOT / "data" / "models"))
    adapter = TripoSRAdapter(Settings(model_cache_dir=Path(cache)))
    assert adapter.validate_environment().ok
    return adapter


def test_triposr_generates_front_facing_mesh(adapter, tmp_path):
    image = np.asarray(Image.open(ROOT / "assets/samples/car.png").convert("RGB"))
    mask = refine_mask(GrabCutSegmenter().segment(image, Prompts()), Prompts())
    normalize(image, mask, tmp_path / "pre", PreprocessOptions())

    result = adapter.generate(
        tmp_path / "pre" / "03_normalized.png",
        GenerationOptions(mc_resolution=128),
        tmp_path / "gen",
        "gpu-test",
    )
    mesh = trimesh.load(result.mesh_path, force="mesh")
    assert len(mesh.faces) > 1000
    assert result.generation_time_ms > 0 and result.peak_vram_mb > 0
    assert result.model_load_time_ms > 0
    # 자동차는 옆으로 길다: 정면(xy) 너비 > 높이, 깊이(z)는 너비보다 작다
    ext = mesh.extents
    assert ext[0] > ext[1] and ext[0] > ext[2]
    assert mesh.visual.kind == "vertex"
