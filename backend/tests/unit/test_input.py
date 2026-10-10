import numpy as np
from PIL import Image

import images
from app.input.validate import load_and_validate


def codes(issues):
    return {i.code for i in issues}


def test_clean_drawing_is_valid(settings):
    loaded = load_and_validate(images.png_bytes(images.drawing()), settings)
    r = loaded.result
    assert r.is_valid, r.errors
    assert r.object_count == 1
    assert 0.1 < r.object_coverage < 0.2
    assert r.foreground_source == "border_color"
    assert r.warnings == []
    assert r.center_offset < 0.05


def test_tiny_image_rejected(settings):
    r = load_and_validate(images.png_bytes(Image.new("RGB", (4, 4))), settings).result
    assert not r.is_valid
    assert "resolution_too_low" in codes(r.errors)


def test_non_image_rejected(settings):
    r = load_and_validate(b"not an image", settings).result
    assert "unsupported_format" in codes(r.errors)


def test_gif_rejected(settings):
    data = images.png_bytes(images.drawing(), fmt="GIF")
    assert "unsupported_format" in codes(load_and_validate(data, settings).result.errors)


def test_file_too_large(settings):
    small = settings.model_copy(update={"max_upload_mb": 0})
    r = load_and_validate(images.png_bytes(images.drawing()), small).result
    assert "file_too_large" in codes(r.errors)


def test_blank_image_has_no_object(settings):
    r = load_and_validate(images.png_bytes(Image.new("RGB", (800, 800), images.PAPER)), settings)
    assert "object_too_small" in codes(r.result.errors)


def test_large_image_downscaled(settings):
    loaded = load_and_validate(
        images.png_bytes(images.drawing(size=(3000, 2400), box=(1000, 800, 2000, 1600))), settings
    )
    assert loaded.image.size == (2048, 1638)
    assert "downscaled" in codes(loaded.result.warnings)


def test_multiple_objects_warns(settings):
    r = load_and_validate(images.png_bytes(images.two_objects()), settings).result
    assert r.is_valid
    assert r.object_count == 2
    assert "multiple_objects" in codes(r.warnings)


def test_cropped_object_warns(settings):
    assert "object_cropped" in codes(
        load_and_validate(images.png_bytes(images.cropped()), settings).result.warnings
    )


def test_transparent_png_uses_alpha(settings):
    loaded = load_and_validate(images.png_bytes(images.transparent()), settings)
    assert loaded.result.foreground_source == "alpha"
    assert loaded.result.has_alpha
    assert loaded.image.mode == "RGBA"
    assert abs(loaded.result.object_coverage - 0.25) < 0.02


def test_low_contrast_warns(settings):
    r = load_and_validate(images.png_bytes(images.low_contrast()), settings).result
    assert "low_contrast" in codes(r.warnings) or "object_too_small" in codes(r.errors)


def test_exif_orientation_applied_and_stripped(settings):
    img = images.drawing(size=(900, 600), box=(300, 150, 600, 450))
    exif = Image.Exif()
    exif[0x0112] = 6  # 90도 회전
    exif[0x010F] = "SecretCamera"
    loaded = load_and_validate(images.png_bytes(img, fmt="JPEG", exif=exif), settings)
    assert loaded.image.size == (600, 900)
    assert not loaded.image.getexif()
    assert "exif" not in loaded.image.info


def test_blurry_image_warns(settings):
    from PIL import ImageFilter

    img = images.drawing().filter(ImageFilter.GaussianBlur(12))
    r = load_and_validate(images.png_bytes(img), settings).result
    assert "blurry" in codes(r.warnings)


def test_mask_is_deterministic(settings):
    a = load_and_validate(images.png_bytes(images.drawing()), settings).result
    b = load_and_validate(images.png_bytes(images.drawing()), settings).result
    assert a.model_dump() == b.model_dump()
    assert np.isfinite(a.blur_score)
