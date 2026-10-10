import numpy as np
import pytest
from PIL import Image, ImageDraw

from app.core.errors import PipelineError
from app.input.foreground import bbox
from app.preprocess.normalize import PreprocessOptions, normalize, stretch_lightness


def scene(size=(800, 600), box=(80, 60, 380, 300)):
    img = Image.new("RGB", size, (246, 243, 236))
    ImageDraw.Draw(img).ellipse(box, fill=(214, 48, 49))
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).ellipse(box, fill=255)
    return np.asarray(img), np.asarray(mask) >= 128


def test_normalize_centers_and_scales(tmp_path):
    image, mask = scene()
    r = normalize(image, mask, tmp_path)
    out = np.asarray(Image.open(r.normalized))
    assert out.shape == (512, 512, 4)
    x0, y0, x1, y1 = bbox(out[..., 3] > 127)
    assert abs((x0 + x1) / 2 - 256) <= 512 * 0.02
    assert abs((y0 + y1) / 2 - 256) <= 512 * 0.02
    assert abs(max(x1 - x0, y1 - y0) / 512 - 0.85) <= 0.05
    assert out[0, 0, 3] == 0 and out[-1, -1, 3] == 0
    for key in ("cutout", "cropped", "normalized"):
        assert Image.open(getattr(r, key)).mode == "RGBA"
    assert (tmp_path / "preprocess.json").exists()


def test_options_respected(tmp_path):
    image, mask = scene()
    r = normalize(image, mask, tmp_path, PreprocessOptions(size=256, foreground_ratio=0.6))
    out = np.asarray(Image.open(r.normalized))
    assert out.shape[:2] == (256, 256)
    assert abs(r.foreground_ratio_actual - 0.6) < 0.01


def test_specks_removed(tmp_path):
    image, mask = scene()
    mask = mask.copy()
    mask[550:553, 750:753] = True
    r = normalize(image, mask, tmp_path)
    cutout = np.asarray(Image.open(r.cutout))
    assert cutout[551, 751, 3] == 0
    assert r.bbox[2] <= 386  # 타원 끝 380 + feather


def test_empty_mask_raises(tmp_path):
    image, mask = scene()
    with pytest.raises(PipelineError):
        normalize(image, np.zeros_like(mask), tmp_path)


def test_no_dark_fringe(tmp_path):
    image, mask = scene()
    r = normalize(image, mask, tmp_path)
    out = np.asarray(Image.open(r.normalized)).astype(int)
    edge = (out[..., 3] > 20) & (out[..., 3] < 235)
    # 반투명 경계 픽셀도 빨간색을 유지해야 한다 (검은 테두리 없음)
    assert out[edge][:, 0].mean() > 150


def test_stretch_only_low_contrast():
    ramp = np.tile(np.linspace(20, 70, 64, dtype=np.uint8), (64, 1))
    dim = np.dstack([ramp] * 3)
    mask = np.ones((64, 64), bool)
    out, adjusted = stretch_lightness(dim, mask)
    assert adjusted
    assert out[mask].mean() > dim[mask].mean()
    _, adjusted_wide = stretch_lightness(
        np.asarray(Image.open(_gradient())), np.ones((64, 64), bool)
    )
    assert not adjusted_wide


def _gradient():
    import io

    arr = np.tile(np.linspace(0, 255, 64, dtype=np.uint8), (64, 1))
    buf = io.BytesIO()
    Image.fromarray(np.dstack([arr] * 3)).save(buf, "PNG")
    buf.seek(0)
    return buf
