"""Sam2Segmenter의 torch 없는 부분: 종이 crop, 초기 박스, 후보 선택."""

import numpy as np
from PIL import Image, ImageDraw

import images
from app.segmentation.base import Prompts
from app.segmentation.sam2 import find_paper, image_key, initial_box, select_candidate


def photo_of_paper():
    """어두운 책상 위 종이(200~700 × 150~650) 사진, 종이 안에 빨간 원."""
    img = Image.new("RGB", (900, 800), (92, 70, 52))
    d = ImageDraw.Draw(img)
    d.rectangle((200, 150, 700, 650), fill=images.PAPER)
    d.ellipse((350, 300, 550, 500), fill=(214, 48, 49), outline=(30, 30, 30), width=6)
    return np.asarray(img)


def test_find_paper_crops_paper_in_photo():
    box = find_paper(photo_of_paper())
    assert box is not None
    x0, y0, x1, y1 = box
    assert abs(x0 - 200) <= 3 and abs(y0 - 150) <= 3
    assert abs(x1 - 701) <= 3 and abs(y1 - 651) <= 3


def test_find_paper_skips_scan_without_border():
    # 스캔·정면 촬영처럼 종이가 이미지 전체면 자르지 않는다
    assert find_paper(np.asarray(images.drawing())) is None


def test_find_paper_none_for_dark_image():
    assert find_paper(np.full((400, 400, 3), 40, np.uint8)) is None


def test_initial_box_uses_foreground_bbox_with_margin():
    rgb = np.asarray(images.drawing(box=(250, 250, 550, 550)))
    x0, y0, x1, y1 = initial_box(rgb, None, Prompts())
    assert 220 <= x0 < 250 and 220 <= y0 < 250
    assert 550 < x1 <= 580 and 550 < y1 <= 580


def test_initial_box_keeps_user_box():
    rgb = np.asarray(images.drawing())
    assert initial_box(rgb, None, Prompts(box=(1, 2, 3, 4))) == (1, 2, 3, 4)


def test_initial_box_expands_to_positive_point_outside():
    rgb = np.asarray(images.drawing(box=(250, 250, 550, 550)))
    x0, y0, x1, y1 = initial_box(rgb, None, Prompts(points=[(700, 400, 1)]))
    assert x1 >= 704 and x0 < 250


def test_initial_box_center_when_blank():
    rgb = np.full((500, 1000, 3), images.PAPER, np.uint8)
    assert initial_box(rgb, None, Prompts()) == (100.0, 50.0, 900.0, 450.0)


def _masks():
    h = w = 100
    small = np.zeros((h, w), bool)
    small[40:60, 40:60] = True
    medium = np.zeros((h, w), bool)
    medium[20:80, 20:80] = True
    paper = np.ones((h, w), bool)
    paper[:2] = False
    return np.stack([small, medium, paper])


def test_select_candidate_rejects_whole_paper():
    # 종이 전체 후보가 점수 최고여도 버린다
    assert select_candidate(_masks(), np.array([0.5, 0.8, 0.99]), []) == 1


def test_select_candidate_rejects_mask_covering_negative_point():
    # 제외점(25, 25)은 medium에만 들어있다 → small
    assert select_candidate(_masks(), np.array([0.5, 0.8, 0.99]), [(25, 25)]) == 0


def test_select_candidate_falls_back_to_best_score():
    empty = np.zeros((3, 50, 50), bool)
    assert select_candidate(empty, np.array([0.1, 0.7, 0.3]), []) == 1


def test_image_key_depends_on_content_and_shape():
    a = np.zeros((10, 20, 3), np.uint8)
    b = a.copy()
    b[0, 0, 0] = 1
    assert image_key(a) == image_key(a.copy())
    assert image_key(a) != image_key(b)
    assert image_key(a) != image_key(a.reshape(20, 10, 3))


def test_retention_removes_old_embedding_cache(ctx):
    import os
    import time

    from app.jobs.retention import cleanup_expired

    cache = ctx.settings.data_dir / "cache" / "sam2" / "m"
    cache.mkdir(parents=True)
    old, new = cache / "old.pt", cache / "new.pt"
    old.write_bytes(b"x")
    new.write_bytes(b"x")
    past = time.time() - (ctx.settings.retention_hours + 1) * 3600
    os.utime(old, (past, past))
    cleanup_expired(ctx)
    assert not old.exists() and new.exists()
