import numpy as np
from PIL import Image, ImageDraw

import images
from app.segmentation.base import Prompts
from app.segmentation.grabcut import GrabCutSegmenter
from app.segmentation.postprocess import fill_holes, keep_main_components, refine_mask


def iou(a, b):
    return (a & b).sum() / (a | b).sum()


def ellipse_mask(size, box):
    img = Image.new("L", size, 0)
    ImageDraw.Draw(img).ellipse(box, fill=255)
    return np.asarray(img) >= 128


def segment(image, prompts=None):
    prompts = prompts or Prompts()
    return refine_mask(GrabCutSegmenter().segment(np.asarray(image), prompts), prompts)


def test_grabcut_finds_drawn_object():
    box = (250, 250, 550, 550)
    mask = segment(images.drawing(box=box))
    assert iou(mask, ellipse_mask((800, 800), box)) > 0.9


def test_grabcut_with_box_selects_one_of_two():
    img = images.two_objects()
    mask = segment(img, Prompts(box=(450, 230, 740, 520)))
    right = ellipse_mask((800, 800), (470, 250, 720, 500))
    assert iou(mask, right) > 0.85
    assert not mask[:, :400].any()


def test_positive_point_keeps_second_object():
    img = images.two_objects()
    prompts = Prompts(points=[(200, 375, 1), (595, 375, 1)], box=(40, 200, 760, 560))
    mask = segment(img, prompts)
    assert mask[375, 200] and mask[375, 595]


def test_negative_point_removes_region():
    img = images.two_objects()
    prompts = Prompts(points=[(595, 375, 0)], box=(40, 200, 760, 560))
    mask = segment(img, prompts)
    assert not mask[375, 595]
    assert mask[375, 200]


def test_alpha_used_when_no_prompts():
    img = images.transparent()
    mask = segment(img)
    assert abs(mask.mean() - 0.25) < 0.02


def test_outline_only_drawing_interior_filled():
    img = Image.new("RGB", (600, 600), images.PAPER)
    ImageDraw.Draw(img).ellipse((150, 150, 450, 450), outline=(20, 20, 20), width=12)
    mask = segment(img)
    assert mask[300, 300]


def test_keep_main_components_drops_specks():
    m = np.zeros((100, 100), bool)
    m[10:60, 10:60] = True
    m[80:83, 80:83] = True
    assert not keep_main_components(m, [])[81, 81]
    assert keep_main_components(m, [(81, 81)])[81, 81]


def test_fill_holes_respects_negative_points():
    m = np.zeros((100, 100), bool)
    m[10:90, 10:90] = True
    m[45:55, 45:55] = False
    assert fill_holes(m, [], 0.1)[50, 50]
    assert not fill_holes(m, [(50, 50)], 0.1)[50, 50]


def test_empty_mask_passthrough():
    m = np.zeros((10, 10), bool)
    assert not refine_mask(m, Prompts()).any()


def test_fill_holes_size_limit():
    m = np.zeros((100, 100), bool)
    m[10:90, 10:90] = True
    m[20:80, 20:80] = False
    assert fill_holes(m, [], None)[50, 50]
    assert not fill_holes(m, [], 0.1)[50, 50]
