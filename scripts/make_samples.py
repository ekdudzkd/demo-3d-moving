"""공개 샘플 그림을 코드로 생성한다 (CC0). 사용: python scripts/make_samples.py [out_dir]

실제 아동 그림 대신, 흰 종이 위 색칠한 그림을 흉내 낸 단순 도형이다.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
PAPER = (246, 243, 236)
INK = (40, 36, 34)


def paper(seed: int) -> Image.Image:
    rng = np.random.default_rng(seed)
    noise = rng.normal(0, 3, (SIZE, SIZE, 1))
    arr = np.clip(np.array(PAPER, dtype=np.float32) + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, "RGB")


def finish(img: Image.Image) -> Image.Image:
    return img.filter(ImageFilter.GaussianBlur(0.8))


def apple() -> Image.Image:
    img = paper(1)
    d = ImageDraw.Draw(img)
    d.ellipse([292, 330, 732, 770], fill=(214, 48, 49), outline=INK, width=10)
    d.ellipse([370, 400, 450, 470], fill=(240, 120, 110))
    d.rectangle([497, 230, 527, 350], fill=(110, 70, 40), outline=INK, width=6)
    d.ellipse([530, 240, 660, 320], fill=(76, 160, 70), outline=INK, width=8)
    return finish(img)


def car() -> Image.Image:
    img = paper(2)
    d = ImageDraw.Draw(img)
    body = [(180, 600), (230, 480), (380, 470), (450, 360), (650, 360), (740, 470), (850, 490),
            (860, 600)]
    d.polygon(body, fill=(52, 120, 220), outline=INK, width=10)
    d.polygon([(470, 380), (545, 380), (545, 470), (410, 470)], fill=(190, 225, 245),
              outline=INK, width=6)
    d.polygon([(570, 380), (635, 380), (705, 470), (570, 470)], fill=(190, 225, 245),
              outline=INK, width=6)
    for cx in (320, 720):
        d.ellipse([cx - 75, 540, cx + 75, 690], fill=(50, 50, 55), outline=INK, width=8)
        d.ellipse([cx - 30, 585, cx + 30, 645], fill=(180, 180, 185))
    return finish(img)


def star() -> Image.Image:
    img = paper(3)
    d = ImageDraw.Draw(img)
    cx, cy, outer, inner = 512, 540, 340, 140
    pts = []
    for i in range(10):
        r = outer if i % 2 == 0 else inner
        a = -math.pi / 2 + i * math.pi / 5
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    d.polygon(pts, fill=(250, 200, 40), outline=INK, width=12)
    d.ellipse([440, 470, 470, 510], fill=INK)
    d.ellipse([555, 470, 585, 510], fill=INK)
    d.arc([450, 520, 575, 600], 20, 160, fill=INK, width=8)
    return finish(img)


SAMPLES = {
    "apple": (apple, "빨간 사과 (단순 원형, 쉬움)"),
    "car": (car, "파란 자동차 (바퀴·창문 등 여러 부분)"),
    "star": (star, "노란 별 캐릭터 (뾰족한 모서리)"),
}


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    manifest = []
    for name, (make, description) in SAMPLES.items():
        path = out / f"{name}.png"
        make().save(path, optimize=True)
        manifest.append({"id": name, "file": path.name, "description": description,
                         "license": "CC0-1.0", "source": "scripts/make_samples.py"})
        print(path)
    (out / "samples.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                                      encoding="utf-8")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parents[1] / "assets/samples")
