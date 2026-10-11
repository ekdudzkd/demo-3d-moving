"""스파이크·평가용 합성 그림 10장 + 정답 마스크를 만든다 (CC0, 코드로 생성).

사용: python scripts/make_spike_drawings.py [out_dir]   (기본 data/spike/drawings, gitignore)

실제 아동 그림이 아니다. 쉬운 그림과 함께 그림에서 흔한 어려운 경우를 일부러 넣었다:
윤곽선만 있음, 연한 크레용, 가는 선, 물체 2개, 책상 위 종이를 찍은 사진.
정답 마스크는 잡음·흐림 없이 그린 깨끗한 그림에서 "종이가 아닌 픽셀 + 안쪽 구멍"으로 만든다.
"""

from __future__ import annotations

import json
import math
import sys
from collections.abc import Callable
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_samples as ms  # noqa: E402

SIZE = ms.SIZE
PAPER, INK = ms.PAPER, ms.INK


def draw_apple(d: ImageDraw.ImageDraw) -> None:
    d.ellipse([292, 330, 732, 770], fill=(214, 48, 49), outline=INK, width=10)
    d.ellipse([370, 400, 450, 470], fill=(240, 120, 110))
    d.rectangle([497, 230, 527, 350], fill=(110, 70, 40), outline=INK, width=6)
    d.ellipse([530, 240, 660, 320], fill=(76, 160, 70), outline=INK, width=8)


def draw_car(d):
    body = [(180, 600), (230, 480), (380, 470), (450, 360), (650, 360), (740, 470),
            (850, 490), (860, 600)]  # fmt: skip
    d.polygon(body, fill=(52, 120, 220), outline=INK, width=10)
    d.polygon([(470, 380), (545, 380), (545, 470), (410, 470)], fill=(190, 225, 245),
              outline=INK, width=6)  # fmt: skip
    d.polygon([(570, 380), (635, 380), (705, 470), (570, 470)], fill=(190, 225, 245),
              outline=INK, width=6)  # fmt: skip
    for cx in (320, 720):
        d.ellipse([cx - 75, 540, cx + 75, 690], fill=(50, 50, 55), outline=INK, width=8)
        d.ellipse([cx - 30, 585, cx + 30, 645], fill=(180, 180, 185))


def star_points(cx, cy, outer, inner):
    pts = []
    for i in range(10):
        r = outer if i % 2 == 0 else inner
        a = -math.pi / 2 + i * math.pi / 5
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def draw_star(d):
    d.polygon(star_points(512, 540, 340, 140), fill=(250, 200, 40), outline=INK, width=12)
    d.ellipse([440, 470, 470, 510], fill=INK)
    d.ellipse([555, 470, 585, 510], fill=INK)
    d.arc([450, 520, 575, 600], 20, 160, fill=INK, width=8)


def draw_fish(d):
    d.ellipse([230, 380, 700, 660], fill=(255, 140, 40), outline=INK, width=10)
    d.polygon([(680, 520), (850, 390), (850, 650)], fill=(255, 110, 30), outline=INK, width=10)
    d.ellipse([320, 470, 370, 520], fill=(255, 255, 255), outline=INK, width=6)
    d.ellipse([335, 485, 357, 507], fill=INK)
    for x in (430, 500, 570):
        d.arc([x - 40, 430, x + 40, 610], 300, 60, fill=INK, width=6)


def draw_house(d):
    d.rectangle([300, 480, 724, 820], fill=(240, 220, 160), outline=INK, width=10)
    d.polygon([(250, 490), (512, 230), (774, 490)], fill=(200, 60, 50), outline=INK, width=10)
    d.rectangle([460, 640, 560, 820], fill=(130, 80, 40), outline=INK, width=8)
    for x in (340, 600):
        d.rectangle([x, 540, x + 90, 620], fill=(170, 210, 240), outline=INK, width=6)


def draw_outline_cat(d):
    # 색칠 없이 윤곽선만 — 분할이 선만 잡고 안쪽을 비우기 쉬운 경우
    head = [(326, 390), (360, 200), (450, 300), (574, 300), (664, 200), (698, 390)]
    for i in range(1, 40):  # 오른쪽 볼 → 턱 → 왼쪽 볼
        t = -0.5 + (math.pi + 1.0) * i / 40
        head.append((512 + 212 * math.cos(t), 510 + 250 * math.sin(t)))
    d.polygon(head, outline=INK, width=9)
    d.ellipse([420, 430, 470, 480], outline=INK, width=8)
    d.ellipse([554, 430, 604, 480], outline=INK, width=8)
    d.polygon([(495, 540), (529, 540), (512, 565)], outline=INK, width=6)
    for y in (560, 590):
        d.line([(380, y), (470, 570)], fill=INK, width=5)
        d.line([(644, y), (554, 570)], fill=INK, width=5)


def draw_crayon_duck(d):
    # 흰 종이 위 연한 노랑 — 배경과 대비가 낮은 경우
    pale, line = (250, 236, 170), (225, 200, 110)
    d.ellipse([260, 470, 720, 770], fill=pale, outline=line, width=6)
    d.ellipse([560, 290, 780, 510], fill=pale, outline=line, width=6)
    d.polygon([(770, 390), (860, 410), (770, 440)], fill=(250, 200, 140), outline=line, width=4)
    d.ellipse([680, 360, 705, 385], fill=(120, 110, 90))


def draw_stick_person(d):
    # 가는 선 사람 — 부피가 거의 없어 3D 생성이 어려운 경우
    d.ellipse([442, 200, 582, 340], outline=INK, width=10)
    d.line([(512, 340), (512, 620)], fill=INK, width=10)
    d.line([(380, 440), (644, 440)], fill=INK, width=10)
    d.line([(512, 620), (410, 820)], fill=INK, width=10)
    d.line([(512, 620), (614, 820)], fill=INK, width=10)


def draw_two_objects(d):
    # 해와 구름 — 주 객체가 모호한 경우
    d.ellipse([140, 200, 420, 480], fill=(255, 190, 40), outline=INK, width=10)
    for x, y, r in ((560, 600, 110), (680, 560, 140), (810, 610, 110), (690, 660, 120)):
        d.ellipse([x - r, y - r, x + r, y + r], fill=(235, 240, 250), outline=(120, 140, 170),
                  width=6)  # fmt: skip


DRAWINGS: dict[str, tuple[Callable, str]] = {
    "apple": (draw_apple, "사과 (쉬움)"),
    "car": (draw_car, "자동차 (여러 부분)"),
    "star": (draw_star, "별 캐릭터 (뾰족한 모서리)"),
    "fish": (draw_fish, "물고기 (꼬리 돌출)"),
    "house": (draw_house, "집 (각진 형태)"),
    "outline_cat": (draw_outline_cat, "고양이 윤곽선만 (내부 미채색)"),
    "crayon_duck": (draw_crayon_duck, "연한 크레용 오리 (저대비)"),
    "stick_person": (draw_stick_person, "막대 사람 (가는 선)"),
    "two_objects": (draw_two_objects, "해와 구름 (물체 2개)"),
}


def render(draw: Callable, seed: int) -> tuple[Image.Image, np.ndarray]:
    clean = Image.new("RGB", (SIZE, SIZE), PAPER)
    draw(ImageDraw.Draw(clean))
    diff = np.abs(np.asarray(clean, np.int16) - np.array(PAPER, np.int16)).sum(axis=2) > 0
    gt = ndimage.binary_fill_holes(diff)

    img = ms.paper(seed)
    draw(ImageDraw.Draw(img))
    return ms.finish(img), gt


def desk_photo(seed: int) -> tuple[Image.Image, np.ndarray]:
    """책상 위에 놓인 종이를 비스듬히 찍은 사진: 나무색 배경, 그림자, 7도 회전, 밝기 불균일."""
    drawing, gt = render(draw_apple, seed)
    w, h = 1400, 1200
    rng = np.random.default_rng(seed)
    wood = np.zeros((h, w, 3), np.float32)
    grain = np.sin(np.linspace(0, 40, w))[None, :] * 8 + rng.normal(0, 4, (h, w))
    wood[...] = np.array([128, 92, 60], np.float32)
    wood += grain[..., None]
    bg = Image.fromarray(np.clip(wood, 0, 255).astype(np.uint8))

    paper_rgba = drawing.convert("RGBA")
    rotated = paper_rgba.rotate(7, resample=Image.Resampling.BICUBIC, expand=True)
    gt_rot = Image.fromarray(gt.astype(np.uint8) * 255).rotate(7, expand=True)
    ox, oy = (w - rotated.width) // 2, (h - rotated.height) // 2

    shadow = Image.new("L", rotated.size, 0)
    shadow.paste(rotated.getchannel("A"))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    bg.paste(Image.new("RGB", rotated.size, (40, 30, 20)), (ox + 25, oy + 30),
             shadow.point(lambda a: a * 0.6))  # fmt: skip
    bg.paste(rotated, (ox, oy), rotated)

    # 왼쪽 위가 밝고 오른쪽 아래가 어두운 조명
    yy, xx = np.mgrid[0:h, 0:w]
    light = 1.05 - 0.25 * (xx / w + yy / h) / 2
    photo = np.clip(np.asarray(bg, np.float32) * light[..., None], 0, 255).astype(np.uint8)

    mask = np.zeros((h, w), bool)
    mask[oy : oy + rotated.height, ox : ox + rotated.width] = np.asarray(gt_rot) >= 128
    return Image.fromarray(photo), mask


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    manifest = []
    items = [(name, (lambda s, f=fn: render(f, s)), desc) for name, (fn, desc) in DRAWINGS.items()]
    items.append(("desk_photo", desk_photo, "책상 위 종이 사진 (회전·그림자·조명)"))
    for seed, (name, make, description) in enumerate(items, start=11):
        img, gt = make(seed)
        img.save(out / f"{name}.png", optimize=True)
        Image.fromarray(gt.astype(np.uint8) * 255).save(out / f"{name}_mask.png", optimize=True)
        manifest.append(
            {
                "id": name,
                "file": f"{name}.png",
                "gt_mask": f"{name}_mask.png",
                "description": description,
                "license": "CC0-1.0",
                "source": "scripts/make_spike_drawings.py",
            }
        )
        print(out / f"{name}.png", f"gt coverage {gt.mean():.3f}")
    (out / "drawings.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else root / "data/spike/drawings")
