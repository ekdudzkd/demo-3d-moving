"""SAM 2 실제 분할 (3-2). `pytest -m gpu`로만 실행. 첫 실행 때 가중치를 받는다."""

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.core.config import Settings
from app.segmentation.base import Prompts
from app.segmentation.postprocess import refine_mask

pytestmark = pytest.mark.gpu

SAMPLES = Path(__file__).resolve().parents[3] / "assets" / "samples"


@pytest.fixture(scope="module")
def segmenter(tmp_path_factory):
    pytest.importorskip("sam2")
    from app.segmentation.sam2 import Sam2Segmenter

    root = Path(__file__).resolve().parents[3]
    settings = Settings(
        data_dir=tmp_path_factory.mktemp("data"), model_cache_dir=root / "data" / "models"
    )
    return Sam2Segmenter(settings)


@pytest.mark.parametrize("name", ["apple", "car", "star"])
def test_sam2_segments_sample(segmenter, name):
    image = np.asarray(Image.open(SAMPLES / f"{name}.png").convert("RGB"))
    mask = refine_mask(segmenter.segment(image, Prompts()), Prompts())
    assert 0.02 < mask.mean() < 0.9
    assert segmenter.last_timing.cache == "miss"

    # 같은 이미지에 포함점 추가 → 임베딩 재사용
    ys, xs = np.nonzero(mask)
    point = (float(xs.mean()), float(ys.mean()), 1)
    again = segmenter.segment(image, Prompts(points=[point]))
    assert segmenter.last_timing.cache == "memory"
    assert segmenter.last_timing.embed_ms == 0
    inter = (again & mask).sum() / max(1, (again | mask).sum())
    assert inter > 0.7


def test_sam2_disk_cache_survives_new_instance(segmenter):
    from app.segmentation.sam2 import Sam2Segmenter

    image = np.asarray(Image.open(SAMPLES / "apple.png").convert("RGB"))
    segmenter.segment(image, Prompts())
    fresh = Sam2Segmenter.__new__(Sam2Segmenter)
    fresh.__dict__.update(segmenter.__dict__)
    fresh._memory = type(segmenter._memory)()
    fresh._current_key = None
    fresh.segment(image, Prompts())
    assert fresh.last_timing.cache == "disk"
