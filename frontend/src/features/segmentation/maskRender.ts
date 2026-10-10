/** 마스크 미리보기 렌더링. 순수 계산 함수는 테스트하고, 캔버스 부분은 브라우저에서만 쓴다. */

/** 마스크(0/255) 경계 픽셀: 전경인데 4-이웃 중 배경이 있는 픽셀 */
export function maskEdges(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) {
        out[i] = 1;
      }
    }
  }
  return out;
}

/** 이미지 좌표 → 축소된 마스크 좌표 변환 없이, 같은 크기 RGBA에서 마스크(0/1) 추출 */
export function alphaToMask(rgba: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4] >= 128 ? 1 : 0;
  return out;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`이미지를 불러올 수 없습니다: ${url}`));
    img.src = url;
  });
}

export interface Previews {
  overlay: string; // 편집용: 원본 + 선택 영역 강조 + 경계
  cutout: string; // 선택된 객체 (배경 투명)
  removed: string; // 제거될 배경 표시
  boundary: string; // 마스크 경계
}

const PREVIEW_MAX = 1024;

export function renderPreviews(original: HTMLImageElement, maskImg: HTMLImageElement): Previews {
  const scale = Math.min(1, PREVIEW_MAX / Math.max(original.naturalWidth, original.naturalHeight));
  const w = Math.round(original.naturalWidth * scale);
  const h = Math.round(original.naturalHeight * scale);

  const draw = (img: HTMLImageElement) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  };
  const base = draw(original);
  const mask = alphaToMask(draw(maskImg).data);
  const edges = maskEdges(mask, w, h);
  const thick = dilate(edges, w, h, Math.max(1, Math.round(w / 400)));

  const make = (fn: (i: number, src: Uint8ClampedArray, dst: Uint8ClampedArray) => void) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    const out = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) fn(i, base.data, out.data);
    ctx.putImageData(out, 0, 0);
    return c.toDataURL("image/png");
  };
  const set = (d: Uint8ClampedArray, i: number, r: number, g: number, b: number, a = 255) => {
    d[i * 4] = r;
    d[i * 4 + 1] = g;
    d[i * 4 + 2] = b;
    d[i * 4 + 3] = a;
  };
  const mix = (s: Uint8ClampedArray, i: number, c: number[], t: number): [number, number, number] => [
    s[i * 4] * (1 - t) + c[0] * t,
    s[i * 4 + 1] * (1 - t) + c[1] * t,
    s[i * 4 + 2] * (1 - t) + c[2] * t,
  ];

  const ACCENT = [163, 107, 37];
  const RED = [200, 40, 40];
  return {
    overlay: make((i, s, d) => {
      if (thick[i]) return set(d, i, 255, 255, 255);
      if (mask[i]) return set(d, i, ...mix(s, i, ACCENT, 0.25));
      return set(d, i, ...mix(s, i, [40, 40, 40], 0.45));
    }),
    cutout: make((i, s, d) => set(d, i, s[i * 4], s[i * 4 + 1], s[i * 4 + 2], mask[i] ? 255 : 0)),
    removed: make((i, s, d) => (mask[i] ? set(d, i, ...mix(s, i, [255, 255, 255], 0.75)) : set(d, i, ...mix(s, i, RED, 0.45)))),
    boundary: make((i, s, d) => (thick[i] ? set(d, i, ...ACCENT as [number, number, number]) : set(d, i, ...mix(s, i, [255, 255, 255], 0.6)))),
  };
}

function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 1) return src;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!src[y * w + x]) continue;
      for (let dy = -r + 1; dy < r; dy++) {
        for (let dx = -r + 1; dx < r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) out[ny * w + nx] = 1;
        }
      }
    }
  }
  return out;
}
