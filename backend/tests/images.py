"""테스트용 이미지를 코드로 생성한다."""

from __future__ import annotations

import io

from PIL import Image, ImageDraw

PAPER = (246, 243, 236)


def png_bytes(img: Image.Image, fmt: str = "PNG", **kwargs) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format=fmt, **kwargs)
    return buf.getvalue()


def drawing(size=(800, 800), box=(250, 250, 550, 550), color=(214, 48, 49)) -> Image.Image:
    img = Image.new("RGB", size, PAPER)
    d = ImageDraw.Draw(img)
    d.ellipse(box, fill=color, outline=(30, 30, 30), width=8)
    return img


def two_objects() -> Image.Image:
    img = Image.new("RGB", (800, 800), PAPER)
    d = ImageDraw.Draw(img)
    d.ellipse((80, 250, 330, 500), fill=(214, 48, 49))
    d.ellipse((470, 250, 720, 500), fill=(52, 120, 220))
    return img


def cropped() -> Image.Image:
    return drawing(box=(500, 200, 900, 600))


def transparent() -> Image.Image:
    img = Image.new("RGBA", (600, 600), (0, 0, 0, 0))
    ImageDraw.Draw(img).rectangle((150, 150, 450, 450), fill=(40, 160, 70, 255))
    return img


def low_contrast() -> Image.Image:
    return drawing(color=(225, 222, 214))
