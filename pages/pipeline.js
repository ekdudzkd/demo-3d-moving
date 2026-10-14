// Draw2World AI 브라우저 데모 파이프라인 (DOM 없음, Node에서도 테스트 가능).
//
// 저장소의 실제 단계를 브라우저로 옮긴 것이다.
//   분할      backend/app/input/foreground.py + segmentation/postprocess.py (배경색 기반 전경 추정)
//   3D 생성   backend/app/generation/mock.py (MockAdapter: 실루엣 돌출, AI 모델 아님)
//   검사      packages/mesh-ready-check/src/mesh_ready_check/inspect.py
//   보정      backend/app/mesh/repair.py (단계별 전후 지표, 나빠지면 그 단계만 롤백)
//   충돌체    backend/app/export/collider.py
// SAM 2·TripoSR 같은 GPU 모델은 돌리지 않는다.

export const SEG_SIZE = 256;
export const TEX_SIZE = 512; // 3D 표면에 입히는 텍스처 한 변 (얼굴 같은 가는 디테일용)
export const WORK = 128; // mock.py WORK
export const DEPTH_RATIO = 0.25; // mock.py DEPTH_RATIO
export const TARGET_SIZE = 1.0; // repair.py TARGET_SIZE (최대 축 1m)
export const SMALL_COMPONENT_RATIO = 0.02;
export const MAX_FACE_LOSS = 0.5;

// 깨끗한 배경 판정: 테두리 ΔE 70백분위가 이보다 작으면 렌더·디지털 그림으로 보고 임계값을 낮춘다
// (70백분위: 테두리 일부에 걸친 글자·라벨이 판정을 흔들지 않게)
const CLEAN_BORDER_NOISE = 2;
const CLEAN_MIN_DELTA = 3.5;
const CLEAN_EDGE_DELTA = 1.8; // 이웃 픽셀 ΔE가 이보다 크면 경계
// mesh_ready_check/thresholds.py
export const DEFAULT_THRESHOLDS = Object.freeze({
  face_budget: 50000,
  small_component_ratio: 0.02,
  min_largest_component_ratio: 0.8,
  non_manifold_warn_ratio: 0.01,
  non_manifold_error_ratio: 0.05,
  long_edge_factor: 20.0,
  flat_ratio: 0.02,
  center_tolerance: 0.05,
  ground_tolerance: 0.01,
  target_size: null,
  size_tolerance: 0.1,
});

export class PipelineError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 1. 분할 (foreground.py estimate_foreground + postprocess.py refine_mask)
// ---------------------------------------------------------------------------

export function alphaIsMeaningful(img) {
  const n = img.width * img.height;
  let transparent = 0;
  for (let i = 0; i < n; i++) if (img.data[i * 4 + 3] < 128) transparent++;
  const r = transparent / n;
  return r > 0.01 && r < 0.99;
}

function median(arr) {
  const s = Float64Array.from(arr).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function borderPixels(img, b) {
  const { width: w, height: h } = img;
  const idx = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y < b || y >= h - b || x < b || x >= w - b) idx.push(y * w + x);
    }
  }
  return idx;
}

/** 정사각형으로 맞춘다. 투명도가 의미 있으면 투명으로, 아니면 테두리 중앙값 색으로 채운다. */
export function squarePad(img) {
  const { width: w, height: h, data } = img;
  if (w === h) return img;
  const n = Math.max(w, h);
  const out = new Uint8ClampedArray(n * n * 4);
  let fill = [0, 0, 0, 0];
  if (!alphaIsMeaningful(img)) {
    const border = borderPixels(img, Math.max(2, Math.floor(Math.min(w, h) * 0.01)));
    fill = [0, 1, 2].map((c) => Math.round(median(border.map((i) => data[i * 4 + c]))));
    fill.push(255);
  }
  for (let i = 0; i < n * n; i++) out.set(fill, i * 4);
  const ox = (n - w) >> 1;
  const oy = (n - h) >> 1;
  for (let y = 0; y < h; y++) {
    out.set(data.subarray((y * w) * 4, (y * w + w) * 4), ((y + oy) * n + ox) * 4);
  }
  return { width: n, height: n, data: out };
}

/** 면적 평균 축소 (cv2.INTER_AREA 근사). 원본이 더 작으면 최근접. */
export function resizeRGBA(img, size) {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(size * size * 4);
  if (w < size || h < size) {
    for (let y = 0; y < size; y++) {
      const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / size));
      for (let x = 0; x < size; x++) {
        const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / size));
        out.set(data.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * size + x) * 4);
      }
    }
    return { width: size, height: size, data: out };
  }
  const acc = new Float64Array(size * size * 4);
  const cnt = new Float64Array(size * size);
  for (let y = 0; y < h; y++) {
    const dy = Math.min(size - 1, Math.floor((y * size) / h));
    for (let x = 0; x < w; x++) {
      const dx = Math.min(size - 1, Math.floor((x * size) / w));
      const d = dy * size + dx;
      const s = (y * w + x) * 4;
      acc[d * 4] += data[s];
      acc[d * 4 + 1] += data[s + 1];
      acc[d * 4 + 2] += data[s + 2];
      acc[d * 4 + 3] += data[s + 3];
      cnt[d]++;
    }
  }
  for (let i = 0; i < size * size; i++) {
    for (let c = 0; c < 4; c++) out[i * 4 + c] = Math.round(acc[i * 4 + c] / cnt[i]);
  }
  return { width: size, height: size, data: out };
}

export function rgbToLab(r, g, b) {
  const lin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const X = (0.412453 * R + 0.35758 * G + 0.180423 * B) / 0.950456;
  const Y = 0.212671 * R + 0.71516 * G + 0.072169 * B;
  const Z = (0.019334 * R + 0.119193 * G + 0.950227 * B) / 1.088754;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const L = Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;
  return [L, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

export function otsu(values) {
  const hist = new Float64Array(256);
  for (const v of values) hist[v]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return best;
}

function morph(mask, w, h, r, isMax) {
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = isMax ? 0 : 1;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) {
        const m = mask[y * w + k];
        if (isMax ? m : !m) {
          v = isMax ? 1 : 0;
          break;
        }
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = isMax ? 0 : 1;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) {
        const m = tmp[k * w + x];
        if (isMax ? m : !m) {
          v = isMax ? 1 : 0;
          break;
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}
export const dilate = (m, w, h, r) => morph(m, w, h, r, true);
export const erode = (m, w, h, r) => morph(m, w, h, r, false);
const open = (m, w, h, r) => dilate(erode(m, w, h, r), w, h, r);
const close = (m, w, h, r) => erode(dilate(m, w, h, r), w, h, r);

/** value(0/1)인 픽셀의 연결 요소. conn8=false면 4-연결. */
export function labelComponents(mask, w, h, value = 1, conn8 = true) {
  const labels = new Int32Array(w * h);
  const sizes = [0];
  const touches = [false];
  const stack = new Int32Array(w * h);
  const nb = conn8
    ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let id = 0;
  for (let s = 0; s < w * h; s++) {
    if (labels[s] || (mask[s] ? 1 : 0) !== value) continue;
    id++;
    let sp = 0;
    let size = 0;
    let touch = false;
    stack[sp++] = s;
    labels[s] = id;
    while (sp) {
      const p = stack[--sp];
      size++;
      const x = p % w;
      const y = (p / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touch = true;
      for (const [dx, dy] of nb) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (!labels[q] && (mask[q] ? 1 : 0) === value) {
          labels[q] = id;
          stack[sp++] = q;
        }
      }
    }
    sizes.push(size);
    touches.push(touch);
  }
  return { labels, count: id, sizes, touches };
}

export function keepLargest(mask, w, h) {
  const { labels, count, sizes } = labelComponents(mask, w, h, 1, true);
  if (count <= 1) return mask;
  let best = 1;
  for (let i = 2; i <= count; i++) if (sizes[i] > sizes[best]) best = i;
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) out[i] = labels[i] === best ? 1 : 0;
  return out;
}

/** 테두리에 닿지 않는 배경 구멍을 채운다 (D-015: 윤곽선만 그린 그림도 안쪽이 찬다). */
export function fillHoles(mask, w, h) {
  const { labels, count, touches } = labelComponents(mask, w, h, 0, false);
  const out = Uint8Array.from(mask);
  if (!count) return out;
  for (let i = 0; i < out.length; i++) if (labels[i] && !touches[labels[i]]) out[i] = 1;
  return out;
}

function cleanMask(mask, w, h, minAreaRatio = 0.001) {
  let m = open(mask, w, h, 1);
  m = close(m, w, h, 2);
  const { labels, sizes } = labelComponents(m, w, h, 1, true);
  const minArea = minAreaRatio * w * h;
  for (let i = 0; i < m.length; i++) if (labels[i] && sizes[labels[i]] < minArea) m[i] = 0;
  return m;
}

/**
 * 주인공 덩어리 고르기: 사진 가장자리에 걸친 덩어리(뒤쪽 사람·벽·액자 틀)보다
 * 가장자리에서 떨어진 덩어리(종이 위 그림)를 고른다. 떨어진 덩어리가 너무 작으면(가장 큰 것의 15% 미만) 가장 큰 것.
 * rect = 원본 그림이 놓인 영역 [x0, y0, x1, y1] (정사각형으로 채운 여백 제외)
 */
export function keepMain(mask, w, h, rect = [0, 0, w - 1, h - 1]) {
  const { labels, count, sizes } = labelComponents(mask, w, h, 1, true);
  if (count <= 1) return mask;
  const [x0, y0, x1, y1] = rect;
  const edge = new Uint8Array(count + 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = labels[y * w + x];
      if (l && (x <= x0 + 1 || y <= y0 + 1 || x >= x1 - 1 || y >= y1 - 1)) edge[l] = 1;
    }
  }
  let best = 1;
  let inner = 0;
  for (let i = 1; i <= count; i++) {
    if (sizes[i] > sizes[best]) best = i;
    if (!edge[i] && (!inner || sizes[i] > sizes[inner])) inner = i;
  }
  const pick = inner && sizes[inner] >= 0.15 * sizes[best] ? inner : best;
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) out[i] = labels[i] === pick ? 1 : 0;
  return out;
}

function refineMask(mask, w, h, rect) {
  let m = open(mask, w, h, 1);
  m = keepMain(m, w, h, rect);
  m = fillHoles(m, w, h);
  return close(m, w, h, 2);
}

function refineClean(mask, S, rect) {
  // 닫기 반지름 1: 경계선 띠(가장자리 1px 표시)가 이미 획을 이어 주므로 크게 닫지 않는다.
  // 반지름 2로 닫으면 두 신발처럼 가까운 두 부분이 붙어, 다리 사이 빈틈이 '구멍'으로 채워졌다
  let m = close(mask, S, S, 1);
  m = fillHoles(m, S, S);
  // 라벨·바닥 그림자처럼 가는 다리로 붙은 덩어리를 떼어 낸다: 크게 열어 가장 큰 덩어리만 남기고,
  // 원래 마스크 안에서 다시 키워 물체 모양은 그대로 되살린다 (형태학적 재구성)
  const core = keepMain(open(m, S, S, 4), S, S, rect);
  let grown = core;
  for (let k = 0; k < 6; k++) {
    const d = dilate(grown, S, S, 1);
    for (let i = 0; i < d.length; i++) d[i] &= m[i];
    grown = d;
  }
  return close(grown, S, S, 1);
}

/**
 * 두 단계 임계값(히스테리시스): dist > hi 인 확실한 전경에서 출발해, dist > lo 인 픽셀 중
 * 8방향으로 이어진 것만 전경으로 넓힌다. 종이와 색 차이가 작은 연한 부분(머리·얼굴·연필선)이
 * 진한 부분(옷)에 붙어 있으면 살리고, 떨어져 있는 종이 얼룩은 버린다.
 */
export function hysteresisMask(dist, S, lo, hi) {
  const N = S * S;
  const mask = new Uint8Array(N);
  const stack = [];
  for (let i = 0; i < N; i++) {
    if (dist[i] > hi) {
      mask[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % S;
    const y = (i - x) / S;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= S) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= S) continue;
        const j = yy * S + xx;
        if (!mask[j] && dist[j] > lo) {
          mask[j] = 1;
          stack.push(j);
        }
      }
    }
  }
  return mask;
}

/** 그림 → 전경 마스크. 반환 rgba는 SEG_SIZE 정사각형. */
// ---------------------------------------------------------------------------
// 사진 보정: 종이·화이트보드에 그린 그림을 찍은 사진 (조명 얼룩·회색 판·액자)
// ---------------------------------------------------------------------------

/** 테두리 색이 고르지 않으면(조명·질감·주변 물건) 사진으로 본다. 디지털 그림(단색 배경)은 false */
export function looksLikePhoto(img) {
  const small = resizeRGBA(squarePad(img), 128);
  const N = 128 * 128;
  const lab = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const [L, A, B] = rgbToLab(small.data[i * 4], small.data[i * 4 + 1], small.data[i * 4 + 2]);
    lab[i * 3] = L;
    lab[i * 3 + 1] = A;
    lab[i * 3 + 2] = B;
  }
  const border = borderPixels(small, 2);
  const bg = [0, 1, 2].map((c) => median(border.map((i) => lab[i * 3 + c])));
  const d = border.map((i) => Math.hypot(lab[i * 3] - bg[0], lab[i * 3 + 1] - bg[1], lab[i * 3 + 2] - bg[2])).sort((a, b) => a - b);
  return (d[Math.floor(d.length * 0.7)] ?? 0) >= CLEAN_BORDER_NOISE;
}

/**
 * 종이·화이트보드 사진을 고르게 편다: 종이는 흰색, 선·색은 또렷하게.
 * 약 64칸 격자에서 '밝고 채도 낮은' 칸만 종이로 골라 채널마다 2차 곡면으로 종이 밝기를 맞추고, 그 값으로 나눈다.
 * 색칠한 넓은 면은 종이 후보가 아니라 색이 지워지지 않는다. 종이가 거의 안 보이면 그대로 돌려준다.
 */
export function flattenPaper(img) {
  const { width: W, height: H, data } = img;
  const k = Math.max(1, Math.ceil(Math.max(W, H) / 64));
  const gw = Math.ceil(W / k);
  const gh = Math.ceil(H / k);
  const cells = [];
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const px = [];
      for (let y = gy * k; y < Math.min(H, gy * k + k); y++) {
        for (let x = gx * k; x < Math.min(W, gx * k + k); x++) {
          const i = (y * W + x) * 4;
          px.push([data[i], data[i + 1], data[i + 2]]);
        }
      }
      px.sort((a, b) => b[0] + b[1] + b[2] - (a[0] + a[1] + a[2]));
      const top = px.slice(0, Math.max(1, Math.ceil(px.length * 0.2))); // 칸 안 밝은 20% = 종이 색 후보
      cells.push({ x: (gx + 0.5) / gw, y: (gy + 0.5) / gh, m: [0, 1, 2].map((c) => top.reduce((s, p) => s + p[c], 0) / top.length) });
    }
  }
  const lum = (m) => (m[0] + m[1] + m[2]) / 3;
  const ls = cells.map((c) => lum(c.m)).sort((a, b) => a - b);
  const bright = ls[Math.floor(ls.length * 0.5)];
  const paper = cells.filter((c) => lum(c.m) >= bright * 0.85 && Math.max(...c.m) - Math.min(...c.m) < 45);
  if (paper.length < 12) return img;
  const basis = (x, y) => [1, x, y, x * x, y * y, x * y];
  const coef = [0, 1, 2].map((ch) => {
    const A = Array.from({ length: 6 }, () => new Float64Array(6));
    const B = new Float64Array(6);
    for (const c of paper) {
      const f = basis(c.x, c.y);
      for (let a = 0; a < 6; a++) {
        B[a] += f[a] * c.m[ch];
        for (let b = 0; b < 6; b++) A[a][b] += f[a] * f[b];
      }
    }
    return solveSmall(A, B);
  });
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const f = basis(x / W, y / H);
      const i = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        let bg = 0;
        for (let a = 0; a < 6; a++) bg += coef[ch][a] * f[a];
        const v = data[i + ch] / Math.max(40, bg); // 종이 ≈ 1
        out[i + ch] = Math.round(255 * Math.min(1, Math.max(0, (v - 0.08) / 0.8))); // 종이(0.88 이상)는 흰색, 선은 진하게
      }
      out[i + 3] = data[i + 3];
    }
  }
  return { width: W, height: H, data: out };
}
function solveSmall(A, B) {
  const n = B.length;
  const M = A.map((r, i) => [...r, B[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}

export function segment(img) {
  const started = now();
  const padded = squarePad(img);
  const rgba = resizeRGBA(padded, SEG_SIZE);
  const hires = resizeRGBA(padded, TEX_SIZE);
  const S = SEG_SIZE;
  const N = S * S;
  let mask = new Uint8Array(N);
  let source;
  let threshold = null;
  let thresholdLow = null;
  let background = null;
  let clean = false;
  if (alphaIsMeaningful(rgba)) {
    source = "alpha";
    for (let i = 0; i < N; i++) mask[i] = rgba.data[i * 4 + 3] >= 128 ? 1 : 0;
  } else {
    source = "border_color";
    const lab = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const [L, A, B] = rgbToLab(rgba.data[i * 4], rgba.data[i * 4 + 1], rgba.data[i * 4 + 2]);
      lab[i * 3] = L;
      lab[i * 3 + 1] = A;
      lab[i * 3 + 2] = B;
    }
    const border = borderPixels(rgba, Math.max(2, Math.floor(S * 0.01)));
    background = [0, 1, 2].map((c) => median(border.map((i) => lab[i * 3 + c])));
    const dist = new Float32Array(N);
    const scaled = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const d = Math.hypot(lab[i * 3] - background[0], lab[i * 3 + 1] - background[1], lab[i * 3 + 2] - background[2]);
      dist[i] = d;
      scaled[i] = Math.min(255, Math.max(0, Math.floor(d * 2)));
    }
    // 종이 질감·조명 얼룩을 전경으로 잡지 않도록 최소 ΔE 15.
    // 단, 테두리가 거의 균일한 깨끗한 배경(렌더·디지털 그림)이면 흰 물체도 잡도록 테두리 잡음 기준으로 낮춘다
    const borderDist = border.map((i) => dist[i]).sort((a, b) => a - b);
    const noise = borderDist[Math.floor(borderDist.length * 0.7)] ?? 0;
    clean = noise < CLEAN_BORDER_NOISE;
    threshold = clean ? Math.max(CLEAN_MIN_DELTA, noise * 3) : Math.max(otsu(scaled) / 2, 15);
    for (let i = 0; i < N; i++) mask[i] = dist[i] > threshold ? 1 : 0;
    if (!clean) {
      // 진한 물체(옷)가 Otsu 임계값을 끌어올려 연한 부분이 사라지는 것을 막는다.
      // 낮은 임계값은 테두리(종이) 색 차이의 95백분위의 3배(최소 ΔE 10)라 종이 질감·조명 얼룩은 넘지 않는다.
      const p95 = borderDist[Math.floor(borderDist.length * 0.95)] ?? 0;
      const lo = Math.min(threshold, Math.max(10, p95 * 3));
      if (lo < threshold) {
        const grown = hysteresisMask(dist, S, lo, threshold);
        let g = 0;
        for (let i = 0; i < N; i++) g += grown[i];
        // 배경이 통째로 이어져 넘치면(전경 60% 초과) 확장을 버리고 기존 결과를 쓴다
        if (g / N <= 0.6) {
          mask = grown;
          thresholdLow = lo;
        }
      }
    }
    if (clean) {
      // 흰 물체의 밝은 윗부분처럼 배경과 거의 같은 색도, 경계(색이 갑자기 바뀌는 선)로 둘러싸이면 구멍 채우기로 찬다
      for (let y = 0; y < S - 1; y++) {
        for (let x = 0; x < S - 1; x++) {
          const i = y * S + x;
          const step = (j) => Math.hypot(lab[i * 3] - lab[j * 3], lab[i * 3 + 1] - lab[j * 3 + 1], lab[i * 3 + 2] - lab[j * 3 + 2]);
          if (Math.max(step(i + 1), step(i + S)) > CLEAN_EDGE_DELTA) mask[i] = 1;
        }
      }
    }
  }
  // 깨끗한 배경은 가는 경계선을 먼저 닫고 채운다(열기를 먼저 하면 경계선이 지워짐)
  // 원본이 놓인 영역(정사각형 여백 제외): 여기 가장자리에 걸친 덩어리는 배경일 가능성이 크다
  const side = Math.max(img.width, img.height);
  const cw = (img.width / side) * S;
  const ch = (img.height / side) * S;
  const rect = [Math.floor((S - cw) / 2), Math.floor((S - ch) / 2), Math.ceil((S + cw) / 2) - 1, Math.ceil((S + ch) / 2) - 1];
  mask = clean ? refineClean(mask, S, rect) : refineMask(cleanMask(mask, S, S), S, S, rect);
  let fg = 0;
  for (let i = 0; i < N; i++) fg += mask[i];
  const coverage = fg / N;
  if (coverage < 0.002) {
    throw new PipelineError("MASK_EMPTY", "객체를 찾지 못했습니다. 배경과 색이 다른 그림을 사용해 주세요.");
  }
  const warnings = [];
  if (coverage > 0.9) warnings.push("전경이 화면 대부분을 차지합니다. 배경이 함께 잡혔을 수 있습니다.");
  return {
    rgba,
    hires,
    mask,
    size: S,
    source,
    threshold,
    threshold_low: thresholdLow,
    background,
    coverage,
    warnings,
    elapsed_ms: Math.round(now() - started),
  };
}

// ---------------------------------------------------------------------------
// 2. 3D 생성 (mock.py silhouette_mesh / add_artifacts)
// ---------------------------------------------------------------------------

export function downsampleMask(mask, S, W) {
  const f = S / W;
  const need = Math.ceil((f * f) / 2);
  const out = new Uint8Array(W * W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      let c = 0;
      for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) c += mask[(y * f + j) * S + x * f + i];
      out[y * W + x] = c >= need ? 1 : 0;
    }
  }
  return out;
}

/** marching squares로 외곽선 루프를 구하고 가장 넓은 루프를 돌려준다 (픽셀 중심 좌표). */
export function largestLoop(mask, W, H = W) {
  const val = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : mask[y * W + x]);
  const G = W + 2;
  const hKey = (x, y) => ((y + 1) * G + (x + 1)) * 2;
  const vKey = (x, y) => ((y + 1) * G + (x + 1)) * 2 + 1;
  const coord = new Map();
  const adj = new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  };
  for (let y = -1; y < H; y++) {
    for (let x = -1; x < W; x++) {
      const c = (val(x, y) << 3) | (val(x + 1, y) << 2) | (val(x + 1, y + 1) << 1) | val(x, y + 1);
      if (c === 0 || c === 15) continue;
      const top = hKey(x, y);
      const bottom = hKey(x, y + 1);
      const left = vKey(x, y);
      const right = vKey(x + 1, y);
      coord.set(top, [x + 0.5, y]);
      coord.set(bottom, [x + 0.5, y + 1]);
      coord.set(left, [x, y + 0.5]);
      coord.set(right, [x + 1, y + 0.5]);
      switch (c) {
        case 1: case 14: link(left, bottom); break;
        case 2: case 13: link(bottom, right); break;
        case 4: case 11: link(top, right); break;
        case 8: case 7: link(top, left); break;
        case 3: case 12: link(left, right); break;
        case 6: case 9: link(top, bottom); break;
        case 5: link(top, left); link(bottom, right); break; // 8-연결: 대각 전경을 잇는다
        case 10: link(top, right); link(bottom, left); break;
      }
    }
  }
  const seen = new Set();
  let best = null;
  let bestArea = 0;
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let prev = -1;
    let cur = start;
    for (let guard = 0; guard < 1e6; guard++) {
      seen.add(cur);
      loop.push(coord.get(cur));
      const nb = adj.get(cur);
      const next = nb[0] !== prev ? nb[0] : nb[1];
      prev = cur;
      cur = next;
      if (cur === start || cur === undefined) break;
    }
    const a = Math.abs(signedArea(loop));
    if (a > bestArea) {
      bestArea = a;
      best = loop;
    }
  }
  return best;
}

export function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

function segDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function douglasPeucker(pts, eps) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let dmax = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(pts[i], pts[s], pts[e]);
      if (d > dmax) {
        dmax = d;
        idx = i;
      }
    }
    if (dmax > eps) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** cv2.approxPolyDP(closed=True) 대응. */
export function simplifyClosed(pts, eps) {
  if (pts.length < 4) return pts.slice();
  let far = 0;
  let dmax = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > dmax) {
      dmax = d;
      far = i;
    }
  }
  const a = douglasPeucker(pts.slice(0, far + 1), eps);
  const b = douglasPeucker(pts.slice(far).concat([pts[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

/** 다각형 변을 maxEdge 이하로 나눈다 (측면·뚜껑 경계가 같은 점을 공유). */
export function resampleLoop(pts, maxEdge) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxEdge - 1e-9));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

const cross2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function inTriangle(p, a, b, c) {
  const eps = -1e-12;
  return cross2(a, b, p) >= eps && cross2(b, c, p) >= eps && cross2(c, a, p) >= eps;
}

/** 반시계 단순 다각형 ear clipping. 반환: [[i,j,k], ...] */
export function earClip(poly) {
  const idx = poly.map((_, i) => i);
  const tris = [];
  let fallbacks = 0;
  while (idx.length > 3) {
    const m = idx.length;
    let clipped = false;
    for (let i = 0; i < m; i++) {
      const ia = idx[(i - 1 + m) % m];
      const ib = idx[i];
      const ic = idx[(i + 1) % m];
      const a = poly[ia];
      const b = poly[ib];
      const c = poly[ic];
      if (cross2(a, b, c) <= 1e-12) continue;
      let blocked = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        const p = poly[j];
        if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === c[0] && p[1] === c[1])) continue;
        if (inTriangle(p, a, b, c)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      tris.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // 자기 교차 등으로 ear가 없으면 가장 볼록한 꼭짓점을 잘라 끝까지 진행한다
      let bi = 0;
      let bc = -Infinity;
      for (let i = 0; i < m; i++) {
        const c = cross2(poly[idx[(i - 1 + m) % m]], poly[idx[i]], poly[idx[(i + 1) % m]]);
        if (c > bc) {
          bc = c;
          bi = i;
        }
      }
      tris.push([idx[(bi - 1 + m) % m], idx[bi], idx[(bi + 1) % m]]);
      idx.splice(bi, 1);
      fallbacks++;
    }
  }
  tris.push([idx[0], idx[1], idx[2]]);
  return { tris, fallbacks };
}

/** 가장 긴 변 이분할로 내부를 세분화한다. 경계 변(maxEdge 이하)은 건드리지 않아 측면과 맞물린다. */
export function refineTriangulation(points, tris, maxEdge, maxPoints = 20000) {
  const pts = points.map((p) => p.slice());
  const T = tris.map((t) => t.slice());
  const edgeMap = new Map();
  const key = (a, b) => (a < b ? a * 1048576 + b : b * 1048576 + a);
  const addTri = (ti) => {
    const t = T[ti];
    for (let k = 0; k < 3; k++) {
      const kk = key(t[k], t[(k + 1) % 3]);
      if (!edgeMap.has(kk)) edgeMap.set(kk, []);
      edgeMap.get(kk).push(ti);
    }
  };
  const removeTri = (ti) => {
    const t = T[ti];
    for (let k = 0; k < 3; k++) {
      const kk = key(t[k], t[(k + 1) % 3]);
      const list = edgeMap.get(kk);
      list.splice(list.indexOf(ti), 1);
      if (!list.length) edgeMap.delete(kk);
    }
  };
  T.forEach((_, i) => addTri(i));
  const len = (a, b) => Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]);
  const longest = (t) => {
    let best = 0;
    let L = -1;
    for (let k = 0; k < 3; k++) {
      const l = len(t[k], t[(k + 1) % 3]);
      if (l > L) {
        L = l;
        best = k;
      }
    }
    return [best, L];
  };
  for (let pass = 0; pass < 64; pass++) {
    const todo = [];
    T.forEach((t, i) => {
      const [, L] = longest(t);
      if (L > maxEdge) todo.push([L, i]);
    });
    if (!todo.length || pts.length > maxPoints) break;
    todo.sort((a, b) => b[0] - a[0]);
    for (const [, ti] of todo) {
      if (pts.length > maxPoints) break;
      const t = T[ti];
      const [k, L] = longest(t);
      if (L <= maxEdge) continue;
      const a = t[k];
      const b = t[(k + 1) % 3];
      const owners = (edgeMap.get(key(a, b)) || []).slice();
      if (owners.length !== 2) continue; // 경계 변은 나누지 않는다
      const m = pts.length;
      pts.push([(pts[a][0] + pts[b][0]) / 2, (pts[a][1] + pts[b][1]) / 2]);
      for (const oi of owners) {
        const o = T[oi];
        let r = 0;
        while (!((o[r] === a && o[(r + 1) % 3] === b) || (o[r] === b && o[(r + 1) % 3] === a))) r++;
        const p = o[r];
        const q = o[(r + 1) % 3];
        const c = o[(r + 2) % 3];
        removeTri(oi);
        T[oi] = [p, m, c];
        addTri(oi);
        T.push([m, q, c]);
        addTri(T.length - 1);
      }
    }
  }
  return { points: pts, tris: T };
}

/** 정점 색: 윤곽선(검정)이 측면에 번지지 않게 깎은 마스크에서 가장 가까운 색 (mock.py _sample_colors). */
function colorSampler(seg) {
  const S = seg.size;
  const solid = seg.mask;
  let fg = 0;
  for (let i = 0; i < solid.length; i++) fg += solid[i];
  // binary_erosion(iterations=k)는 십자 구조 → 맨해튼 거리 k 이내 깎기
  const iters = Math.max(1, Math.round(S * 0.02));
  let inner = Uint8Array.from(solid);
  for (let it = 0; it < iters; it++) {
    const next = Uint8Array.from(inner);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        if (!inner[i]) continue;
        if (x === 0 || y === 0 || x === S - 1 || y === S - 1 || !inner[i - 1] || !inner[i + 1] || !inner[i - S] || !inner[i + S]) next[i] = 0;
      }
    }
    inner = next;
  }
  let innerCount = 0;
  for (let i = 0; i < inner.length; i++) innerCount += inner[i];
  const source = innerCount > 0.2 * fg ? inner : solid;
  // 다중 시작점 BFS로 가장 가까운 source 픽셀 (EDT 근사)
  const nearest = new Int32Array(S * S).fill(-1);
  const queue = new Int32Array(S * S);
  let qh = 0;
  let qt = 0;
  for (let i = 0; i < S * S; i++) {
    if (source[i]) {
      nearest[i] = i;
      queue[qt++] = i;
    }
  }
  while (qh < qt) {
    const p = queue[qh++];
    const x = p % S;
    const y = (p / S) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
      const q = ny * S + nx;
      if (nearest[q] < 0) {
        nearest[q] = nearest[p];
        queue[qt++] = q;
      }
    }
  }
  const d = seg.rgba.data;
  const sampler = (x, y) => {
    const px = Math.min(S - 1, Math.max(0, Math.floor((x + 0.5) * S)));
    const py = Math.min(S - 1, Math.max(0, Math.floor((0.5 - y) * S)));
    const n = nearest[py * S + px];
    if (n < 0) return [0.5, 0.5, 0.5];
    return [d[n * 4] / 255, d[n * 4 + 1] / 255, d[n * 4 + 2] / 255];
  };
  sampler.nearest = nearest;
  sampler.source = source;
  return sampler;
}

/**
 * 표면에 입힐 텍스처. 윤곽선 안쪽(깎은 마스크)은 원본 그림 그대로, 바깥은 가장 가까운 안쪽 색으로 채운다.
 * 옆면은 윤곽선 위치의 텍스처를 읽으므로, 검은 윤곽선이 옆면에 번지지 않는다.
 * 앞·뒷면은 점 색을 섞는 대신 이 그림을 픽셀 단위로 읽어 눈·입 같은 가는 디테일이 남는다.
 */
function bakeTexture(seg, sample) {
  const S = seg.size;
  const src = seg.hires && seg.hires.width > S ? seg.hires : seg.rgba;
  const T = src.width;
  const k = T / S;
  const out = new Uint8ClampedArray(T * T * 4);
  for (let y = 0; y < T; y++) {
    const ly = Math.min(S - 1, Math.floor(y / k));
    for (let x = 0; x < T; x++) {
      const lx = Math.min(S - 1, Math.floor(x / k));
      const li = ly * S + lx;
      const o = (y * T + x) * 4;
      let sx = x;
      let sy = y;
      if (!sample.source[li]) {
        const n = sample.nearest[li];
        if (n < 0) {
          out[o] = out[o + 1] = out[o + 2] = 128;
          out[o + 3] = 255;
          continue;
        }
        const nx = n % S;
        sx = Math.min(T - 1, Math.floor((nx + 0.5) * k));
        sy = Math.min(T - 1, Math.floor(((n - nx) / S + 0.5) * k));
      }
      const s = (sy * T + sx) * 4;
      out[o] = src.data[s];
      out[o + 1] = src.data[s + 1];
      out[o + 2] = src.data[s + 2];
      out[o + 3] = 255;
    }
  }
  return { size: T, data: out };
}

export function makeMesh(v, f, c, uv = null) {
  const m = { v: Float64Array.from(v), f: Uint32Array.from(f), c: Float32Array.from(c) };
  if (uv) m.uv = Float32Array.from(uv);
  return m;
}

export function cloneMesh(m) {
  const out = { v: m.v.slice(), f: m.f.slice(), c: m.c.slice() };
  if (m.uv) out.uv = m.uv.slice();
  return out;
}

/**
 * 실루엣 → 두께 있는 메시.
 * mode "extrude": mock.py와 같은 평평한 돌출. "inflate": 같은 외곽선에서 가운데를 부풀린 변형.
 * depthAt(x, y) → [z뒤, z앞]을 주면 정면 점마다 그 두께 구간을 쓴다 (6방향 예상 그림의 실루엣 교차, D-031).
 * depthAt은 정면 외곽 상자 {xmin, xmax, ymin, ymax}를 받아 만든다: makeDepth(box).
 */
export function generateMesh(seg, { mode = "extrude", artifacts = true, seed = 0, makeDepth = null } = {}) {
  const started = now();
  let m = downsampleMask(seg.mask, seg.size, WORK);
  m = fillHoles(keepLargest(m, WORK, WORK), WORK, WORK);
  const loop = largestLoop(m, WORK);
  if (!loop || loop.length < 3) throw new PipelineError("MESH_EMPTY", "mock: 실루엣 없음");
  const contour = simplifyClosed(loop, 0.8);
  if (contour.length < 3) throw new PipelineError("MESH_EMPTY", "mock: 실루엣이 너무 작음");

  // 이미지 좌표 → x 오른쪽, y 위쪽, 한 변 1.0
  let poly = contour.map(([x, y]) => [x / WORK - 0.5, 0.5 - y / WORK]);
  if (signedArea(poly) < 0) poly.reverse();
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const width = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const depth = width * DEPTH_RATIO;
  // mock.py는 subdivide_to_size(max_edge=width*0.03). 브라우저에서는 속도를 위해 조금 성기게 나눈다
  const maxEdge = width * 0.05;

  const boundary = resampleLoop(poly, maxEdge);
  const nb = boundary.length;
  const { tris: capTris, fallbacks } = earClip(boundary);
  const { points, tris } = refineTriangulation(boundary, capTris, maxEdge);
  for (const t of tris) {
    if (cross2(points[t[0]], points[t[1]], points[t[2]]) < 0) [t[1], t[2]] = [t[2], t[1]];
  }

  const np = points.length;
  const half = new Float64Array(np);
  const back = new Float64Array(np);
  if (makeDepth) {
    const box = { xmin: Math.min(...xs), xmax: Math.max(...xs), ymin: Math.min(...ys), ymax: Math.max(...ys) };
    const depthAt = makeDepth(box);
    for (let i = 0; i < np; i++) [back[i], half[i]] = depthAt(points[i][0], points[i][1]);
  } else if (mode === "inflate") {
    const dist = points.map((p, i) => {
      if (i < nb) return 0;
      let d = Infinity;
      for (let k = 0; k < nb; k++) d = Math.min(d, segDist(p, boundary[k], boundary[(k + 1) % nb]));
      return d;
    });
    const dmax = Math.max(1e-9, ...dist);
    const rim = depth * 0.15;
    const bulge = width * 0.18;
    for (let i = 0; i < np; i++) {
      const t = dist[i] / dmax;
      half[i] = rim + bulge * Math.sqrt(Math.max(0, 1 - (1 - t) ** 2));
      back[i] = -half[i];
    }
  } else {
    half.fill(depth / 2);
    back.fill(-depth / 2);
  }

  const sample = colorSampler(seg);
  const v = [];
  const c = [];
  const uvs = [];
  const f = [];
  const pushV = (x, y, z) => {
    v.push(x, y, z);
    c.push(...sample(x, y));
    uvs.push(x + 0.5, y + 0.5); // 텍스처 좌표: 입력 그림(정사각형) 위치 그대로, v는 위쪽이 1
    return v.length / 3 - 1;
  };
  for (let i = 0; i < np; i++) pushV(points[i][0], points[i][1], half[i]);
  for (let i = 0; i < np; i++) pushV(points[i][0], points[i][1], back[i]);
  const frontFaces = tris.length;
  for (const [a, b, cc] of tris) f.push(a, b, cc);
  for (const [a, b, cc] of tris) f.push(np + cc, np + b, np + a);
  const sideStart = f.length / 3;
  for (let i = 0; i < nb; i++) {
    const j = (i + 1) % nb;
    f.push(i, np + i, np + j, i, np + j, j);
  }
  let mesh = makeMesh(v, f, c, uvs);
  const info = {
    mode: makeDepth ? "views" : mode,
    contour_points: contour.length,
    contour: poly,
    boundary_points: nb,
    width,
    depth,
    max_edge: maxEdge,
    triangulation_fallbacks: fallbacks,
    injected: [],
  };
  if (artifacts) mesh = addArtifacts(mesh, seed, { frontFaces, sideStart, sideCount: nb * 2 }, info.injected);
  info.vertex_count = mesh.v.length / 3;
  info.face_count = mesh.f.length / 3;
  info.elapsed_ms = Math.round(now() - started);
  return { mesh, info, texture: bakeTexture(seg, sample) };
}

function icosahedron(r) {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  const v = raw.flatMap((p) => {
    const l = Math.hypot(...p);
    return p.map((q) => (q / l) * r);
  });
  const f = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  return { v, f };
}

/**
 * 실제 생성 모델 출력처럼 문제를 섞는다.
 * mock.py와 동일: 떠 있는 작은 조각 + 원점 어긋남.
 * 데모 추가분: 측면 정점 분리(중복 정점), 뒤집힌 면 패치, 면적 0인 면.
 */
export function addArtifacts(mesh, seed, layout, injected = []) {
  const rnd = mulberry32(seed + 1);
  const uni = (a, b) => a + (b - a) * rnd();
  const v = Array.from(mesh.v);
  const c = Array.from(mesh.c);
  const uv = mesh.uv ? Array.from(mesh.uv) : null;
  const f = Array.from(mesh.f);
  const color = (i) => [c[i * 3], c[i * 3 + 1], c[i * 3 + 2]];

  // (a) 측면 정점 분리 → 위치만 같은 중복 정점
  const remap = new Map();
  for (let fi = layout.sideStart; fi < layout.sideStart + layout.sideCount; fi++) {
    for (let k = 0; k < 3; k++) {
      const old = f[fi * 3 + k];
      if (!remap.has(old)) {
        remap.set(old, v.length / 3);
        v.push(v[old * 3], v[old * 3 + 1], v[old * 3 + 2]);
        c.push(...color(old));
        if (uv) uv.push(uv[old * 2], uv[old * 2 + 1]);
      }
      f[fi * 3 + k] = remap.get(old);
    }
  }
  injected.push({ code: "duplicate_vertices", label: `측면 정점 분리 → 중복 정점 ${remap.size}개`, origin: "demo" });

  // (b) 앞면 일부 면 방향 뒤집기
  const pick = Math.floor(rnd() * layout.frontFaces);
  const cx = (fi) => (v[f[fi * 3] * 3] + v[f[fi * 3 + 1] * 3] + v[f[fi * 3 + 2] * 3]) / 3;
  const cy = (fi) => (v[f[fi * 3] * 3 + 1] + v[f[fi * 3 + 1] * 3 + 1] + v[f[fi * 3 + 2] * 3 + 1]) / 3;
  const px = cx(pick);
  const py = cy(pick);
  const dists = [];
  for (let fi = 0; fi < layout.frontFaces; fi++) dists.push([Math.hypot(cx(fi) - px, cy(fi) - py), fi]);
  dists.sort((a, b) => a[0] - b[0]);
  const flipN = Math.max(3, Math.round(layout.frontFaces * 0.04));
  for (let k = 0; k < flipN && k < dists.length; k++) {
    const fi = dists[k][1];
    [f[fi * 3 + 1], f[fi * 3 + 2]] = [f[fi * 3 + 2], f[fi * 3 + 1]];
  }
  injected.push({ code: "inconsistent_winding", label: `앞면 ${flipN}개 면 방향 뒤집힘`, origin: "demo" });

  // (c) 면적 0인 면 (한 변 위에 놓인 점)
  for (let k = 0; k < 2; k++) {
    const fi = dists[Math.min(dists.length - 1, flipN + 5 + k * 7)][1];
    const a = f[fi * 3];
    const b = f[fi * 3 + 1];
    const mIdx = v.length / 3;
    v.push((v[a * 3] + v[b * 3]) / 2, (v[a * 3 + 1] + v[b * 3 + 1]) / 2, (v[a * 3 + 2] + v[b * 3 + 2]) / 2);
    c.push(...color(a));
    if (uv) uv.push((uv[a * 2] + uv[b * 2]) / 2, (uv[a * 2 + 1] + uv[b * 2 + 1]) / 2);
    f.push(a, b, mIdx);
  }
  injected.push({ code: "degenerate_faces", label: "면적 0인 면 2개", origin: "demo" });

  // (d) mock.py: 떠 있는 작은 조각 (icosphere r=0.02)
  const n0 = v.length / 3;
  let hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n0; i++) for (let k = 0; k < 3; k++) hi[k] = Math.max(hi[k], v[i * 3 + k]);
  const off = hi.map((h) => h + uni(0.05, 0.15));
  const chip = icosahedron(0.02);
  for (let i = 0; i < chip.v.length; i += 3) {
    v.push(chip.v[i] + off[0], chip.v[i + 1] + off[1], chip.v[i + 2] + off[2]);
    c.push(0.5, 0.5, 0.5);
    if (uv) uv.push(0, 0);
  }
  for (const idx of chip.f) f.push(idx + n0);
  injected.push({ code: "small_components", label: "떠 있는 작은 조각 1개", origin: "mock" });

  // (e) mock.py: 원점 중심(바닥 아님) + 약간 어긋남
  const out = makeMesh(v, f, c, uv);
  const [lo, hi2] = bounds(out);
  const shift = [0, 1, 2].map((k) => -(lo[k] + hi2[k]) / 2 + uni(-0.05, 0.05));
  for (let i = 0; i < out.v.length; i += 3) for (let k = 0; k < 3; k++) out.v[i + k] += shift[k];
  injected.push({ code: "not_grounded", label: "원점 중심 배치 (바닥에 닿지 않음)·크기 미정규화", origin: "mock" });
  return out;
}

// ---------------------------------------------------------------------------
// 공통 메시 도구
// ---------------------------------------------------------------------------

export function bounds(mesh) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.v.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const x = mesh.v[i + k];
      if (x < lo[k]) lo[k] = x;
      if (x > hi[k]) hi[k] = x;
    }
  }
  return [lo, hi];
}

/** 위치가 같은 정점(소수 8자리)을 하나로 묶는 대응표. */
export function weldMap(v) {
  const n = v.length / 3;
  const map = new Int32Array(n);
  const seen = new Map();
  const first = [];
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(v[i * 3] * 1e8)},${Math.round(v[i * 3 + 1] * 1e8)},${Math.round(v[i * 3 + 2] * 1e8)}`;
    let id = seen.get(k);
    if (id === undefined) {
      id = first.length;
      seen.set(k, id);
      first.push(i);
    }
    map[i] = id;
  }
  return { map, count: first.length, first };
}

function triGeom(v, a, b, c) {
  const ux = v[b * 3] - v[a * 3];
  const uy = v[b * 3 + 1] - v[a * 3 + 1];
  const uz = v[b * 3 + 2] - v[a * 3 + 2];
  const wx = v[c * 3] - v[a * 3];
  const wy = v[c * 3 + 1] - v[a * 3 + 1];
  const wz = v[c * 3 + 2] - v[a * 3 + 2];
  const nx = uy * wz - uz * wy;
  const ny = uz * wx - ux * wz;
  const nz = ux * wy - uy * wx;
  const len = Math.hypot(nx, ny, nz);
  return { area: len / 2, n: len ? [nx / len, ny / len, nz / len] : [0, 0, 0] };
}

/** 변 → 그 변을 쓰는 면들. 정점 인덱스는 map(있으면)을 거친다. */
function edgeTable(f, map) {
  const table = new Map();
  const nf = f.length / 3;
  const id = (i) => (map ? map[i] : i);
  for (let fi = 0; fi < nf; fi++) {
    for (let k = 0; k < 3; k++) {
      const a = id(f[fi * 3 + k]);
      const b = id(f[fi * 3 + ((k + 1) % 3)]);
      if (a === b) continue;
      const key = a < b ? a * 4194304 + b : b * 4194304 + a;
      let e = table.get(key);
      if (!e) {
        e = { a: Math.min(a, b), b: Math.max(a, b), faces: [], dirs: [] };
        table.set(key, e);
      }
      e.faces.push(fi);
      e.dirs.push(a < b ? 1 : -1);
    }
  }
  return table;
}

/** 면 인접(정확히 두 면이 공유하는 변)으로 연결 요소 라벨. trimesh face_adjacency 기준. */
function faceComponents(nf, table) {
  const parent = new Int32Array(nf).map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (const e of table.values()) {
    if (e.faces.length !== 2) continue;
    const ra = find(e.faces[0]);
    const rb = find(e.faces[1]);
    if (ra !== rb) parent[ra] = rb;
  }
  const labels = new Int32Array(nf);
  const ids = new Map();
  for (let i = 0; i < nf; i++) {
    const r = find(i);
    if (!ids.has(r)) ids.set(r, ids.size);
    labels[i] = ids.get(r);
  }
  const sizes = new Array(ids.size).fill(0);
  for (let i = 0; i < nf; i++) sizes[labels[i]]++;
  return { labels, sizes };
}

// ---------------------------------------------------------------------------
// 3. 검사 (mesh_ready_check/inspect.py inspect_mesh)
// ---------------------------------------------------------------------------

export function inspectMesh(mesh, thresholds = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const v = mesh.v;
  const f = mesh.f;
  const r = {
    vertex_count: v.length / 3,
    face_count: f.length / 3,
    connected_components: 0,
    small_components: 0,
    largest_component_ratio: 0,
    open_boundary_edges: 0,
    non_manifold_edges: 0,
    duplicate_vertices: 0,
    degenerate_faces: 0,
    long_edges: 0,
    winding_consistent: true,
    inverted_normals: false,
    has_vertex_colors: false,
    bounds: [[0, 0, 0], [0, 0, 0]],
    extents: [0, 0, 0],
    centered: false,
    grounded: false,
    below_floor: false,
    checks: [],
    thresholds: t,
  };
  const add = (code, severity, message, value = null) => r.checks.push({ code, severity, message, value });
  const finish = () => {
    r.errors = r.checks.filter((c) => c.severity === "error").map((c) => c.code);
    r.warnings = r.checks.filter((c) => c.severity === "warn").map((c) => c.code);
    r.is_usable = r.errors.length === 0;
    r.outcome = !r.is_usable ? "NOT_USABLE" : r.warnings.length ? "USABLE_WITH_WARNINGS" : "USABLE";
    return r;
  };
  if (!r.face_count || !r.vertex_count) {
    add("empty_mesh", "error", "면이 없는 빈 메시입니다.");
    return finish();
  }
  for (let i = 0; i < v.length; i++) {
    if (!Number.isFinite(v[i])) {
      add("non_finite_vertices", "error", "NaN 또는 무한대 좌표가 있습니다.");
      return finish();
    }
  }

  // visuals
  r.has_vertex_colors = !!mesh.c && mesh.c.length === v.length;
  if (!r.has_vertex_colors) add("no_color", "warn", "텍스처와 정점 색이 모두 없습니다.");

  // bounds
  const [lo, hi] = bounds(mesh);
  const ext = [0, 1, 2].map((k) => hi[k] - lo[k]);
  r.bounds = [lo, hi];
  r.extents = ext;
  const size = Math.max(...ext);
  if (size <= 0) {
    add("degenerate_bounds", "error", "모든 정점이 한 점에 모여 있습니다.");
    return finish();
  }
  const flat = Math.min(...ext) / size;
  if (flat < t.flat_ratio) add("flat_geometry", "warn", "종잇장처럼 납작한 형상입니다. 뒷면이 무너졌을 가능성이 있습니다.", +flat.toFixed(4));
  const center = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
  r.centered = Math.abs(center[0]) <= t.center_tolerance * size && Math.abs(center[2]) <= t.center_tolerance * size;
  if (!r.centered) add("not_centered", "warn", "모델이 원점(x, z) 중앙에 있지 않습니다.", [+center[0].toFixed(4), +center[2].toFixed(4)]);
  const tol = t.ground_tolerance * size;
  r.grounded = Math.abs(lo[1]) <= tol;
  r.below_floor = lo[1] < -tol;
  if (!r.grounded) add("not_grounded", "warn", r.below_floor ? "바닥(y=0) 아래로 내려간 부분이 있습니다." : "바닥에 닿아 있지 않습니다.", +lo[1].toFixed(4));
  if (t.target_size != null) {
    const dev = Math.abs(size - t.target_size) / t.target_size;
    if (dev > t.size_tolerance) add("wrong_scale", "warn", `최대 축 길이가 기대값 ${t.target_size}와 다릅니다.`, +size.toFixed(4));
  }

  // 위치가 같은 정점을 합친 사본으로 위상 검사
  const weld = weldMap(v);
  const map = weld.map;
  r.duplicate_vertices = r.vertex_count - weld.count;
  if (r.duplicate_vertices) add("duplicate_vertices", "warn", "위치가 같은 중복 정점이 있습니다.", r.duplicate_vertices);

  const table = edgeTable(f, map);
  const nf = r.face_count;

  // components
  const { sizes } = faceComponents(nf, table);
  sizes.sort((a, b) => b - a);
  r.connected_components = sizes.length;
  r.largest_component_ratio = sizes[0] / nf;
  r.small_components = sizes.filter((s) => s < t.small_component_ratio * nf).length;
  if (r.largest_component_ratio < t.min_largest_component_ratio) {
    add("fragmented", "error", "가장 큰 조각이 전체의 일부뿐입니다. 배경이 메시로 생성됐거나 형상이 분리됐을 수 있습니다.", +r.largest_component_ratio.toFixed(4));
  }
  if (r.small_components) add("small_components", "warn", "떠 있는 작은 분리 조각이 있습니다.", r.small_components);

  // edges
  const lengths = [];
  const P = (i) => weld.first[i];
  let winding = true;
  for (const e of table.values()) {
    const n = e.faces.length;
    if (n === 1) r.open_boundary_edges++;
    else if (n > 2) r.non_manifold_edges++;
    else if (e.dirs[0] === e.dirs[1]) winding = false;
    const a = P(e.a);
    const b = P(e.b);
    lengths.push(Math.hypot(v[a * 3] - v[b * 3], v[a * 3 + 1] - v[b * 3 + 1], v[a * 3 + 2] - v[b * 3 + 2]));
  }
  if (r.open_boundary_edges) add("open_boundary", "warn", "닫히지 않은 열린 경계(구멍)가 있습니다.", r.open_boundary_edges);
  const nmRatio = r.non_manifold_edges / nf;
  if (nmRatio > t.non_manifold_error_ratio) add("non_manifold", "error", "non-manifold edge가 너무 많습니다.", r.non_manifold_edges);
  else if (nmRatio > t.non_manifold_warn_ratio) add("non_manifold", "warn", "non-manifold edge가 있습니다.", r.non_manifold_edges);
  else if (r.non_manifold_edges) add("non_manifold", "info", "non-manifold edge가 소수 있습니다.", r.non_manifold_edges);
  if (lengths.length) {
    const med = median(lengths);
    if (med > 0) {
      r.long_edges = lengths.filter((l) => l > med * t.long_edge_factor).length;
      if (r.long_edges) add("long_edges", "warn", "비정상적으로 긴 edge가 있습니다.", r.long_edges);
    }
  }

  // faces + normals (합친 정점 위치 기준)
  const eps = size * size * 1e-12;
  const bc = center;
  let score = 0;
  let areaSum = 0;
  for (let fi = 0; fi < nf; fi++) {
    const a = P(map[f[fi * 3]]);
    const b = P(map[f[fi * 3 + 1]]);
    const c = P(map[f[fi * 3 + 2]]);
    const g = triGeom(v, a, b, c);
    if (g.area <= eps) r.degenerate_faces++;
    const ox = (v[a * 3] + v[b * 3] + v[c * 3]) / 3 - bc[0];
    const oy = (v[a * 3 + 1] + v[b * 3 + 1] + v[c * 3 + 1]) / 3 - bc[1];
    const oz = (v[a * 3 + 2] + v[b * 3 + 2] + v[c * 3 + 2]) / 3 - bc[2];
    score += (g.n[0] * ox + g.n[1] * oy + g.n[2] * oz) * g.area;
    areaSum += g.area;
  }
  if (r.degenerate_faces) add("degenerate_faces", "warn", "면적이 0인 면이 있습니다.", r.degenerate_faces);
  r.winding_consistent = winding;
  if (!winding) add("inconsistent_winding", "warn", "면 방향(winding)이 일관되지 않습니다.");
  const scale = areaSum * size;
  r.inverted_normals = scale > 0 && score / scale < -0.01;
  if (r.inverted_normals) add("inverted_normals", "warn", "노멀이 안쪽을 향하는 것으로 보입니다.");

  if (r.face_count > t.face_budget) add("too_many_faces", "warn", `면 수가 예산 ${t.face_budget}을 넘습니다.`, r.face_count);
  return finish();
}

// ---------------------------------------------------------------------------
// 4. 보정 (backend/app/mesh/repair.py)
// ---------------------------------------------------------------------------

export function metrics(mesh, budget) {
  const r = inspectMesh(mesh, { face_budget: budget, target_size: TARGET_SIZE });
  return {
    vertex_count: r.vertex_count,
    face_count: r.face_count,
    connected_components: r.connected_components,
    small_components: r.small_components,
    open_boundary_edges: r.open_boundary_edges,
    non_manifold_edges: r.non_manifold_edges,
    duplicate_vertices: r.duplicate_vertices,
    degenerate_faces: r.degenerate_faces,
    winding_consistent: r.winding_consistent,
    inverted_normals: r.inverted_normals,
    centered: r.centered,
    grounded: r.grounded,
    extents: r.extents,
    errors: [...r.errors].sort(),
    warnings: [...r.warnings].sort(),
  };
}

/** 사용하는 정점만 남기고 번호를 다시 매긴다. */
export function compact(v, f, c, uv = null) {
  const n = v.length / 3;
  const used = new Int32Array(n).fill(-1);
  const nv = [];
  const nc = [];
  const nuv = [];
  const nf = new Uint32Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const o = f[i];
    if (used[o] < 0) {
      used[o] = nv.length / 3;
      nv.push(v[o * 3], v[o * 3 + 1], v[o * 3 + 2]);
      nc.push(c[o * 3], c[o * 3 + 1], c[o * 3 + 2]);
      if (uv) nuv.push(uv[o * 2], uv[o * 2 + 1]);
    }
    nf[i] = used[o];
  }
  const res = { v: Float64Array.from(nv), f: nf, c: Float32Array.from(nc) };
  if (uv) res.uv = Float32Array.from(nuv);
  return res;
}

function keepFaces(m, keep) {
  const f = [];
  for (let fi = 0; fi < m.f.length / 3; fi++) if (keep(fi)) f.push(m.f[fi * 3], m.f[fi * 3 + 1], m.f[fi * 3 + 2]);
  return compact(m.v, f, m.c, m.uv);
}

export function mergeVertices(m) {
  const { map, count, first } = weldMap(m.v);
  const v = new Float64Array(count * 3);
  const c = new Float32Array(count * 3);
  const uv = m.uv ? new Float32Array(count * 2) : null;
  first.forEach((o, i) => {
    v.set(m.v.subarray(o * 3, o * 3 + 3), i * 3);
    c.set(m.c.subarray(o * 3, o * 3 + 3), i * 3);
    if (uv) uv.set(m.uv.subarray(o * 2, o * 2 + 2), i * 2);
  });
  const res = { v, f: m.f.map((i) => map[i]), c };
  if (uv) res.uv = uv;
  return res;
}

export function removeDegenerateFaces(m) {
  const seen = new Set();
  return keepFaces(m, (fi) => {
    const a = m.f[fi * 3];
    const b = m.f[fi * 3 + 1];
    const c = m.f[fi * 3 + 2];
    if (a === b || b === c || a === c) return false;
    const g = triGeom(m.v, a, b, c);
    const longest = Math.max(
      Math.hypot(m.v[a * 3] - m.v[b * 3], m.v[a * 3 + 1] - m.v[b * 3 + 1], m.v[a * 3 + 2] - m.v[b * 3 + 2]),
      Math.hypot(m.v[b * 3] - m.v[c * 3], m.v[b * 3 + 1] - m.v[c * 3 + 1], m.v[b * 3 + 2] - m.v[c * 3 + 2]),
      Math.hypot(m.v[c * 3] - m.v[a * 3], m.v[c * 3 + 1] - m.v[a * 3 + 1], m.v[c * 3 + 2] - m.v[a * 3 + 2]),
    );
    if (!longest || (2 * g.area) / longest <= 1e-10) return false;
    const key = [a, b, c].sort((x, y) => x - y).join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function removeSmallComponents(m) {
  const { map } = weldMap(m.v);
  const nf = m.f.length / 3;
  const { labels, sizes } = faceComponents(nf, edgeTable(m.f, map));
  if (sizes.length <= 1) return m;
  let largest = 0;
  sizes.forEach((s, i) => {
    if (s > sizes[largest]) largest = i;
  });
  return keepFaces(m, (fi) => sizes[labels[fi]] >= SMALL_COMPONENT_RATIO * nf || labels[fi] === largest);
}

/** trimesh.repair.fix_normals(multibody=True): winding을 맞추고, 조각마다 부피가 음수면 뒤집는다. */
export function fixNormals(m) {
  const nf = m.f.length / 3;
  const { map } = weldMap(m.v);
  const table = edgeTable(m.f, map);
  const neighbors = Array.from({ length: nf }, () => []);
  for (const e of table.values()) {
    if (e.faces.length !== 2) continue;
    const [f0, f1] = e.faces;
    const same = e.dirs[0] === e.dirs[1];
    neighbors[f0].push([f1, same]);
    neighbors[f1].push([f0, same]);
  }
  const flip = new Int8Array(nf).fill(-1);
  const comp = new Int32Array(nf);
  let compCount = 0;
  for (let s = 0; s < nf; s++) {
    if (flip[s] >= 0) continue;
    flip[s] = 0;
    comp[s] = compCount;
    const queue = [s];
    while (queue.length) {
      const fi = queue.pop();
      for (const [g, same] of neighbors[fi]) {
        if (flip[g] >= 0) continue;
        // 같은 방향으로 변을 쓰면 상대 면을 (내 상태 기준) 뒤집어야 한다
        flip[g] = same ? 1 - flip[fi] : flip[fi];
        comp[g] = compCount;
        queue.push(g);
      }
    }
    compCount++;
  }
  const f = Uint32Array.from(m.f);
  for (let fi = 0; fi < nf; fi++) if (flip[fi]) [f[fi * 3 + 1], f[fi * 3 + 2]] = [f[fi * 3 + 2], f[fi * 3 + 1]];
  const vol = new Float64Array(compCount);
  const v = m.v;
  for (let fi = 0; fi < nf; fi++) {
    const a = f[fi * 3] * 3;
    const b = f[fi * 3 + 1] * 3;
    const c = f[fi * 3 + 2] * 3;
    vol[comp[fi]] +=
      v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) -
      v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) +
      v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
  }
  for (let fi = 0; fi < nf; fi++) if (vol[comp[fi]] < 0) [f[fi * 3 + 1], f[fi * 3 + 2]] = [f[fi * 3 + 2], f[fi * 3 + 1]];
  return { v: m.v, f, c: m.c, uv: m.uv };
}

/** trimesh.repair.fill_holes: 삼각형·사각형 크기 구멍만 채운다. */
export function fillSmallHoles(m) {
  const table = edgeTable(m.f, null);
  const out = new Map(); // 경계 변 a→b (면이 쓰는 방향)
  const deg = new Map();
  for (const e of table.values()) {
    if (e.faces.length !== 1) continue;
    const [from, to] = e.dirs[0] > 0 ? [e.a, e.b] : [e.b, e.a];
    if (out.has(from)) out.set(from, -1);
    else out.set(from, to);
    deg.set(from, (deg.get(from) || 0) + 1);
    deg.set(to, (deg.get(to) || 0) + 1);
  }
  const f = Array.from(m.f);
  const done = new Set();
  for (const start of out.keys()) {
    if (done.has(start)) continue;
    const loop = [start];
    let cur = out.get(start);
    while (cur !== undefined && cur !== -1 && cur !== start && loop.length <= 5) {
      loop.push(cur);
      cur = out.get(cur);
    }
    loop.forEach((x) => done.add(x));
    if (cur !== start || (loop.length !== 3 && loop.length !== 4)) continue;
    if (loop.some((x) => deg.get(x) !== 2)) continue;
    // 기존 면은 a→b로 쓰므로 새 면은 반대 방향
    if (loop.length === 3) f.push(loop[0], loop[2], loop[1]);
    else f.push(loop[0], loop[3], loop[2], loop[0], loop[2], loop[1]);
  }
  return { v: m.v, f: Uint32Array.from(f), c: m.c, uv: m.uv };
}

/**
 * 면 예산을 넘으면 quadric error 기반 edge collapse로 줄인다 (trimesh simplify_quadric_decimation 대응).
 * link condition을 지키는 collapse만 해서 manifold를 유지하고, 면이 뒤집히는 collapse는 건너뛴다.
 */
export function decimate(m, budget) {
  const nf0 = m.f.length / 3;
  if (nf0 <= budget) return m;
  const nv = m.v.length / 3;
  const P = Array.from({ length: nv }, (_, i) => [m.v[i * 3], m.v[i * 3 + 1], m.v[i * 3 + 2]]);
  const C = Array.from({ length: nv }, (_, i) => [m.c[i * 3], m.c[i * 3 + 1], m.c[i * 3 + 2]]);
  const U = m.uv ? Array.from({ length: nv }, (_, i) => [m.uv[i * 2], m.uv[i * 2 + 1]]) : null;
  const F = Array.from({ length: nf0 }, (_, i) => [m.f[i * 3], m.f[i * 3 + 1], m.f[i * 3 + 2]]);
  const VF = Array.from({ length: nv }, () => new Set());
  F.forEach((t, i) => t.forEach((x) => VF[x].add(i)));
  const Q = Array.from({ length: nv }, () => new Float64Array(10));
  const normalOf = (t, pos = (x) => P[x]) => {
    const a = pos(t[0]);
    const b = pos(t[1]);
    const c = pos(t[2]);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
  };
  F.forEach((t) => {
    const n = normalOf(t);
    const len = Math.hypot(...n);
    if (!len) return;
    const [a, b, c] = n.map((x) => x / len);
    const p = P[t[0]];
    const d = -(a * p[0] + b * p[1] + c * p[2]);
    const w = len / 2;
    const K = [a * a, a * b, a * c, a * d, b * b, b * c, b * d, c * c, c * d, d * d];
    for (const x of t) for (let k = 0; k < 10; k++) Q[x][k] += K[k] * w;
  });
  const err = (q, p) => {
    const [x, y, z] = p;
    return q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9];
  };
  const ring = (x) => {
    const s = new Set();
    for (const fi of VF[x]) for (const y of F[fi]) if (y !== x) s.add(y);
    return s;
  };
  let faces = nf0;
  for (let pass = 0; pass < 200 && faces > budget; pass++) {
    const edges = [];
    const seen = new Set();
    F.forEach((t) => {
      if (!t) return;
      for (let k = 0; k < 3; k++) {
        const a = Math.min(t[k], t[(k + 1) % 3]);
        const b = Math.max(t[k], t[(k + 1) % 3]);
        const key = a * 4194304 + b;
        if (seen.has(key)) continue;
        seen.add(key);
        const q = Q[a].map((x, i) => x + Q[b][i]);
        const mid = [0, 1, 2].map((d) => (P[a][d] + P[b][d]) / 2);
        let best = mid;
        let e = err(q, mid);
        for (const cand of [P[a], P[b]]) {
          const ce = err(q, cand);
          if (ce < e - 1e-15) {
            e = ce;
            best = cand.slice();
          }
        }
        edges.push([e, a, b, best]);
      }
    });
    edges.sort((x, y) => x[0] - y[0]);
    const touched = new Uint8Array(nv);
    let collapsed = 0;
    for (const [, a, b, p] of edges) {
      if (faces <= budget) break;
      if (touched[a] || touched[b]) continue;
      const shared = [...VF[a]].filter((fi) => VF[b].has(fi));
      if (shared.length !== 2) continue;
      const ra = ring(a);
      const rb = ring(b);
      const common = [...ra].filter((x) => rb.has(x));
      if (common.length !== 2) continue; // link condition
      const pos = (x) => (x === a || x === b ? p : P[x]);
      let flips = false;
      for (const fi of new Set([...VF[a], ...VF[b]])) {
        if (shared.includes(fi)) continue;
        const n0 = normalOf(F[fi]);
        const n1 = normalOf(F[fi], pos);
        const l0 = Math.hypot(...n0);
        const l1 = Math.hypot(...n1);
        if (l1 < 1e-9 || l1 < l0 * 0.02 || (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) / (l0 * l1 || 1) < 0.3) {
          flips = true;
          break;
        }
      }
      if (flips) continue;
      // b → a
      P[a] = p;
      C[a] = C[a].map((x, i) => (x + C[b][i]) / 2);
      if (U) U[a] = U[a].map((x, i) => (x + U[b][i]) / 2);
      for (let k = 0; k < 10; k++) Q[a][k] += Q[b][k];
      for (const fi of shared) {
        for (const x of F[fi]) VF[x].delete(fi);
        F[fi] = null;
        faces--;
      }
      for (const fi of VF[b]) {
        F[fi] = F[fi].map((x) => (x === b ? a : x));
        VF[a].add(fi);
      }
      VF[b].clear();
      for (const x of ra) touched[x] = 1;
      for (const x of rb) touched[x] = 1;
      touched[a] = touched[b] = 1;
      collapsed++;
    }
    if (!collapsed) break;
  }
  const v = P.flat();
  const c = C.flat();
  const u = U ? U.flat() : null;
  const f = F.filter(Boolean).flat();
  return compact(v, f, c, u);
}

export function normalizeScale(m) {
  const [lo, hi] = bounds(m);
  const size = Math.max(...[0, 1, 2].map((k) => hi[k] - lo[k]));
  if (size <= 0) return m;
  const s = TARGET_SIZE / size;
  return { v: m.v.map((x) => x * s), f: m.f, c: m.c, uv: m.uv };
}

export function centerAndGround(m) {
  const [lo, hi] = bounds(m);
  const shift = [-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2];
  return { v: m.v.map((x, i) => x + shift[i % 3]), f: m.f, c: m.c, uv: m.uv };
}

export const STEPS = [
  { name: "merge_vertices", label: "중복 정점 병합", fn: (m) => mergeVertices(m) },
  { name: "remove_degenerate_faces", label: "면적 0·중복 면 제거", fn: (m) => removeDegenerateFaces(m) },
  { name: "remove_small_components", label: "작은 분리 조각 제거", fn: (m) => removeSmallComponents(m), mayDropFaces: true },
  { name: "fix_normals", label: "면 방향·노멀 정리", fn: (m) => fixNormals(m) },
  { name: "fill_small_holes", label: "작은 구멍 채우기", fn: (m) => fillSmallHoles(m) },
  { name: "decimate", label: "면 예산에 맞춰 감소", fn: (m, b) => decimate(m, b), mayDropFaces: true },
  { name: "remove_small_components_after_decimate", label: "감소 뒤 작은 조각 제거", fn: (m) => removeSmallComponents(m), mayDropFaces: true },
  { name: "remove_degenerate_faces_after_decimate", label: "감소 뒤 면적 0인 면 제거", fn: (m) => removeDegenerateFaces(mergeVertices(m)) },
  { name: "normalize_scale", label: "최대 축 1m로 크기 정규화", fn: (m) => normalizeScale(m) },
  { name: "center_and_ground", label: "원점 중앙·바닥(y=0)에 놓기", fn: (m) => centerAndGround(m) },
];

function regression(step, before, after) {
  if (after.face_count === 0) return "면이 모두 사라짐";
  const newErrors = after.errors.filter((e) => !before.errors.includes(e));
  if (newErrors.length) return `새 오류 발생: ${JSON.stringify(newErrors)}`;
  if (step.name !== "decimate") {
    const lost = 1 - after.face_count / Math.max(before.face_count, 1);
    if (lost > MAX_FACE_LOSS) return `면 ${Math.round(lost * 100)}% 손실`;
  }
  return "";
}

/** 단계마다 전후 지표를 기록하고 지표가 나빠지면 그 단계만 되돌린다. 원본은 건드리지 않는다. */
export function repairMesh(mesh, budget = DEFAULT_THRESHOLDS.face_budget, steps = STEPS) {
  const log = [];
  let current = cloneMesh(mesh);
  let before = metrics(current, budget);
  for (const step of steps) {
    const started = now();
    const entry = { name: step.name, label: step.label, applied: false, rolled_back: false, reason: "" };
    let candidate = null;
    let after = before;
    let reason = "";
    try {
      candidate = step.fn(cloneMesh(current), budget);
      after = metrics(candidate, budget);
      reason = regression(step, before, after);
    } catch (err) {
      reason = `${err.name}: ${err.message}`;
    }
    if (reason) {
      Object.assign(entry, { rolled_back: true, reason, before, after: before });
    } else {
      Object.assign(entry, { applied: true, before, after });
      current = candidate;
      before = after;
    }
    entry.changed = JSON.stringify(entry.before) !== JSON.stringify(entry.after);
    entry.elapsed_ms = Math.round(now() - started);
    log.push(entry);
  }
  return { mesh: current, steps: log };
}

// report/build.py DIFF_METRICS
export const DIFF_METRICS = [
  ["face_count", null],
  ["vertex_count", null],
  ["connected_components", "lower"],
  ["open_boundary_edges", "lower"],
  ["non_manifold_edges", "lower"],
  ["duplicate_vertices", "lower"],
  ["degenerate_faces", "lower"],
  ["centered", "true"],
  ["grounded", "true"],
  ["winding_consistent", "true"],
];

export function qualityDiff(raw, repaired) {
  return DIFF_METRICS.map(([key, better]) => {
    const a = raw[key];
    const b = repaired[key];
    let verdict = "same";
    if (a !== b && better === "lower") verdict = b < a ? "better" : "worse";
    else if (a !== b && better === "true") verdict = b ? "better" : "worse";
    else if (a !== b) verdict = "changed";
    return { key, raw: a, repaired: b, verdict };
  });
}

// ---------------------------------------------------------------------------
// 5. 충돌체 (backend/app/export/collider.py)
// ---------------------------------------------------------------------------

export const MAX_HULL_POINTS = 64;
const COLLIDER_FLAT_RATIO = 0.01;
const MIN_THICKNESS_RATIO = 0.02;

export function farthestPoints(points, k) {
  if (points.length <= k) return points;
  const mean = [0, 1, 2].map((d) => points.reduce((s, p) => s + p[d], 0) / points.length);
  const dist3 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  let first = 0;
  points.forEach((p, i) => {
    if (dist3(p, mean) > dist3(points[first], mean)) first = i;
  });
  const chosen = [first];
  const dist = points.map((p) => dist3(p, points[first]));
  for (let i = 0; i < k - 1; i++) {
    let nxt = 0;
    dist.forEach((d, j) => {
      if (d > dist[nxt]) nxt = j;
    });
    chosen.push(nxt);
    points.forEach((p, j) => {
      dist[j] = Math.min(dist[j], dist3(p, points[nxt]));
    });
  }
  return chosen.map((i) => points[i]);
}

export function buildCollider(mesh) {
  const [lo, hi] = bounds(mesh);
  const ext = [0, 1, 2].map((k) => hi[k] - lo[k]);
  const center = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
  const size = Math.max(...ext);
  const half = ext.map((e) => Math.max(e / 2, (size * MIN_THICKNESS_RATIO) / 2));
  let radius = 0;
  for (let i = 0; i < mesh.v.length; i += 3) {
    radius = Math.max(radius, Math.hypot(mesh.v[i] - center[0], mesh.v[i + 1] - center[1], mesh.v[i + 2] - center[2]));
  }
  const collider = {
    type: "bounding_box",
    box: { center, half_extents: half },
    sphere: { center, radius },
    points: null,
    reason: "",
  };
  if (size <= 0 || Math.min(...ext) / size < COLLIDER_FLAT_RATIO) {
    collider.reason = "형상이 납작해 convex hull 대신 두께를 준 상자 사용";
    return collider;
  }
  // convex hull 정점 대신 전체 정점에서 최원점 샘플링 (hull 위 점이 자연히 뽑힌다)
  const { first } = weldMap(mesh.v);
  const pts = first.map((i) => [mesh.v[i * 3], mesh.v[i * 3 + 1], mesh.v[i * 3 + 2]]);
  collider.type = "convex_hull";
  collider.points = farthestPoints(pts, MAX_HULL_POINTS);
  return collider;
}

/** 전체 파이프라인 (UI 없이). 테스트·자동 실행용. */
export function runPipeline(img, { mode = "extrude", artifacts = true, seed = 0, budget = DEFAULT_THRESHOLDS.face_budget } = {}) {
  const seg = segment(img);
  const gen = generateMesh(seg, { mode, artifacts, seed });
  const th = { face_budget: budget, target_size: TARGET_SIZE };
  const rawReport = inspectMesh(gen.mesh, th);
  const repair = repairMesh(gen.mesh, budget);
  const repairedReport = inspectMesh(repair.mesh, th);
  const collider = buildCollider(repair.mesh);
  return { seg, gen, rawReport, repair, repairedReport, collider, diff: qualityDiff(rawReport, repairedReport) };
}
