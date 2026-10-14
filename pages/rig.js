// 그림 관절(뼈대) — 순수 계산. 화면·three.js와 무관해서 node 테스트로 확인한다.
// 좌표: 관절은 입력 그림(정사각형 패딩) 기준 정규화 좌표 [ix, iy] (0~1, iy는 아래로 증가).
// 메시 UV는 u = ix, v = 1 - iy 이므로 정점마다 그림 위치를 알 수 있다 → 그림 위에서 거리로 뼈 가중치를 정한다.

/** 뼈대 틀. bones: at = 회전 중심 관절, segs = 이 뼈가 맡는 그림 위 선분('이름+'는 끝을 조금 늘린 점) */
export const TEMPLATES = {
  human: {
    id: "human",
    name: "사람형",
    joints: ["head", "neck", "torso", "hip", "sL", "eL", "hL", "sR", "eR", "hR", "hipL", "kL", "fL", "hipR", "kR", "fR"],
    labels: { head: "머리", neck: "목", torso: "가슴", hip: "골반", sL: "어깨", eL: "팔꿈치", hL: "손", sR: "어깨", eR: "팔꿈치", hR: "손", hipL: "엉덩이", kL: "무릎", fL: "발", hipR: "엉덩이", kR: "무릎", fR: "발" },
    bones: [
      { name: "root", at: "hip", parent: null, segs: [["hip", "torso"], ["hip", "hipL"], ["hip", "hipR"]] },
      { name: "chest", at: "torso", parent: "root", segs: [["torso", "neck"], ["torso", "sL"], ["torso", "sR"]] },
      { name: "head", at: "neck", parent: "chest", segs: [["neck", "head+"]] },
      { name: "uaL", at: "sL", parent: "chest", segs: [["sL", "eL"]] },
      { name: "faL", at: "eL", parent: "uaL", segs: [["eL", "hL+"]] },
      { name: "uaR", at: "sR", parent: "chest", segs: [["sR", "eR"]] },
      { name: "faR", at: "eR", parent: "uaR", segs: [["eR", "hR+"]] },
      { name: "thL", at: "hipL", parent: "root", segs: [["hipL", "kL"]] },
      { name: "shL", at: "kL", parent: "thL", segs: [["kL", "fL+"]] },
      { name: "thR", at: "hipR", parent: "root", segs: [["hipR", "kR"]] },
      { name: "shR", at: "kR", parent: "thR", segs: [["kR", "fR+"]] },
    ],
  },
  quad: {
    id: "quad",
    name: "네발 동물",
    joints: ["head", "neck", "withers", "pelvis", "tail", "fls", "flk", "flf", "frs", "frk", "frf", "hls", "hlk", "hlf", "hrs", "hrk", "hrf"],
    labels: { head: "머리", neck: "목", withers: "어깨(등)", pelvis: "골반", tail: "꼬리", fls: "앞다리1", flk: "앞무릎1", flf: "앞발1", frs: "앞다리2", frk: "앞무릎2", frf: "앞발2", hls: "뒷다리1", hlk: "뒷무릎1", hlf: "뒷발1", hrs: "뒷다리2", hrk: "뒷무릎2", hrf: "뒷발2" },
    bones: [
      { name: "root", at: "pelvis", parent: null, segs: [["pelvis", "withers"]] },
      { name: "neck", at: "withers", parent: "root", segs: [["withers", "neck"]] },
      { name: "head", at: "neck", parent: "neck", segs: [["neck", "head+"]] },
      { name: "tail", at: "pelvis", parent: "root", segs: [["pelvis", "tail+"]], weak: true },
      { name: "flu", at: "fls", parent: "root", segs: [["fls", "flk"]] },
      { name: "fll", at: "flk", parent: "flu", segs: [["flk", "flf+"]] },
      { name: "fru", at: "frs", parent: "root", segs: [["frs", "frk"]] },
      { name: "frl", at: "frk", parent: "fru", segs: [["frk", "frf+"]] },
      { name: "hlu", at: "hls", parent: "root", segs: [["hls", "hlk"]] },
      { name: "hll", at: "hlk", parent: "hlu", segs: [["hlk", "hlf+"]] },
      { name: "hru", at: "hrs", parent: "root", segs: [["hrs", "hrk"]] },
      { name: "hrl", at: "hrk", parent: "hru", segs: [["hrk", "hrf+"]] },
    ],
  },
};

/** 편집기에서 그릴 선 */
export const linesOf = (tpl) => tpl.bones.flatMap((b) => b.segs.map(([a, c]) => [a, c.replace("+", "")]));

/** '이름+' = 그 관절을 바깥쪽으로 조금 늘린 점 (손·발·머리 끝까지 덮게) */
const EXT = { "head+": ["neck", 0.9], "hL+": ["eL", 0.45], "hR+": ["eR", 0.45], "fL+": ["kL", 0.3], "fR+": ["kR", 0.3], "flf+": ["flk", 0.2], "frf+": ["frk", 0.2], "hlf+": ["hlk", 0.2], "hrf+": ["hrk", 0.2], "tail+": ["pelvis", 0.15] };
export function pointOf(joints, name) {
  if (!name.endsWith("+")) return joints[name];
  const base = name.slice(0, -1);
  const [from, k] = EXT[name] || [null, 0];
  const p = joints[base];
  const q = from ? joints[from] : p;
  return [p[0] + (p[0] - q[0]) * k, p[1] + (p[1] - q[1]) * k];
}

// ── 마스크 도우미 ──
function bbox(mask, S) {
  let x0 = S;
  let x1 = -1;
  let y0 = S;
  let y1 = -1;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++)
      if (mask[y * S + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        sx += x;
        sy += y;
        n++;
      }
  return n ? { x0, x1, y0, y1, W: x1 - x0 + 1, H: y1 - y0 + 1, cx: sx / n, cy: sy / n, n } : null;
}
/** y행에서 x를 포함하는(없으면 가장 가까운) 전경 구간 [a, b] */
function runAt(mask, S, y, x) {
  y = Math.max(0, Math.min(S - 1, Math.round(y)));
  x = Math.max(0, Math.min(S - 1, Math.round(x)));
  const row = y * S;
  let best = null;
  let bd = Infinity;
  for (let i = 0; i < S; ) {
    if (!mask[row + i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < S && mask[row + j + 1]) j++;
    const d = x < i ? i - x : x > j ? x - j : 0;
    if (d < bd) {
      bd = d;
      best = [i, j];
    }
    i = j + 1;
  }
  return best;
}
/** x 좌표들을 큰 빈틈으로 나눈 묶음들 [{a,b,c}] */
function clusters(xs, gap) {
  xs.sort((p, q) => p - q);
  const out = [];
  let a = xs[0];
  let prev = xs[0];
  let sum = 0;
  let n = 0;
  for (const x of xs) {
    if (x - prev > gap) {
      out.push({ a, b: prev, c: sum / n, n });
      a = x;
      sum = 0;
      n = 0;
    }
    sum += x;
    n++;
    prev = x;
  }
  if (n) out.push({ a, b: prev, c: sum / n, n });
  return out;
}

/** 실루엣 비율로 기본 뼈대를 고른다: 세로로 긴 그림은 사람형, 아니면 관절 없음(네발은 사용자가 고른다) */
export function chooseTemplate(mask, S) {
  const b = bbox(mask, S);
  if (!b) return "none";
  return b.H > b.W * 1.15 ? "human" : "none";
}

/** 마스크에서 관절 위치를 어림잡는다. 정확하지 않아도 되고, 편집기에서 끌어서 고친다 */
export function estimateJoints(mask, S, templateId) {
  const b = bbox(mask, S);
  if (!b) return null;
  const J = templateId === "quad" ? quadJoints(mask, S, b) : humanJoints(mask, S, b);
  const out = {};
  for (const [k, [x, y]] of Object.entries(J)) out[k] = [Math.min(1, Math.max(0, (x + 0.5) / S)), Math.min(1, Math.max(0, (y + 0.5) / S))];
  return out;
}

function humanJoints(mask, S, b) {
  const { x0, x1, y0, y1, W, H, cx } = b;
  const at = (x, y) => (x >= 0 && y >= 0 && x < S && y < S ? mask[Math.round(y) * S + Math.round(x)] : 0);
  // 목: 위쪽 12~50% 구간에서 몸 중심을 지나는 구간 폭이 가장 좁은 줄
  const widths = [];
  for (let y = Math.round(y0 + 0.12 * H); y <= Math.round(y0 + 0.5 * H); y++) {
    const r = runAt(mask, S, y, cx);
    widths.push({ y, w: r ? r[1] - r[0] + 1 : 0, c: r ? (r[0] + r[1]) / 2 : cx });
  }
  const sm = widths.map((w, i) => ({ ...w, s: widths.slice(Math.max(0, i - 2), i + 3).reduce((a, q) => a + q.w, 0) / Math.min(widths.length, 5) }));
  const sorted = sm.map((q) => q.s).sort((p, q) => p - q);
  const med = sorted[sorted.length >> 1] || 1;
  let neckRow = sm.reduce((m, q) => (q.s < m.s ? q : m), sm[0]);
  if (!neckRow || neckRow.s > med * 0.88) neckRow = sm.find((q) => q.y >= y0 + 0.28 * H) || { y: y0 + 0.28 * H, c: cx };
  const neckY = neckRow.y;
  const headMid = runAt(mask, S, (y0 + neckY) / 2, cx);
  const head = [headMid ? (headMid[0] + headMid[1]) / 2 : cx, (y0 + neckY) / 2];

  // 다리 x: 신발이 붙어 있어도 갈라져 보이도록 발목 위 띠(아래 5~14%)에서 먼저 나눠 보고, 안 되면 맨 아래 띠로
  const bandXs = (ya, yb) => {
    const xs = [];
    for (let y = Math.round(ya); y <= Math.round(yb); y++) for (let x = x0; x <= x1; x++) if (mask[y * S + x]) xs.push(x);
    return xs;
  };
  const split = (xs) => (xs.length ? clusters(xs, Math.max(2, 0.025 * W)).filter((c) => c.n > xs.length * 0.05) : []);
  let cl = split(bandXs(y1 - 0.14 * H, y1 - 0.05 * H));
  if (cl.length < 2) cl = split(bandXs(y1 - 0.04 * H, y1));
  let fLx;
  let fRx;
  if (cl.length >= 2) {
    fLx = cl[0].c;
    fRx = cl[cl.length - 1].c;
  } else {
    const a = cl[0]?.a ?? x0;
    const c = cl[0]?.b ?? x1;
    fLx = a + (c - a) * 0.28;
    fRx = c - (c - a) * 0.28;
  }
  const footY = y1 - 0.02 * H;
  // 가랑이: 아래(발목 위)에서 위로 올라가며 두 다리 사이에 배경이 있는 마지막 줄. 처음부터 막혀 있으면(치마 등) 키의 62%
  const gapBetween = (y) => {
    for (let x = Math.round(fLx) + 1; x < Math.round(fRx); x++) if (!at(x, y)) return true;
    return false;
  };
  let crotchY = y0 + 0.62 * H;
  let y = Math.round(y1 - 0.06 * H);
  if (fRx - fLx > 2 && gapBetween(y)) {
    while (y > y0 && gapBetween(y)) y--;
    crotchY = y;
  }
  crotchY = Math.min(y1 - 0.12 * H, Math.max(neckY + 0.3 * (y1 - neckY), crotchY));
  const hipY = crotchY - 0.03 * H;
  const hipRun = runAt(mask, S, hipY, cx);
  const hipX = hipRun ? (hipRun[0] + hipRun[1]) / 2 : cx;
  const hipL = [hipX + (fLx - hipX) * 0.55, hipY];
  const hipR = [hipX + (fRx - hipX) * 0.55, hipY];
  const kneeY = (hipY + footY) / 2;
  const legX = (hx, fx) => {
    const r = runAt(mask, S, kneeY, (hx + fx) / 2);
    return r ? (r[0] + r[1]) / 2 : (hx + fx) / 2;
  };
  // 어깨: 목 조금 아래 줄의 몸통 구간 양쪽 안쪽
  const shY = neckY + 0.06 * H;
  const sr = runAt(mask, S, shY + 0.02 * H, cx) || [cx - 0.15 * W, cx + 0.15 * W];
  const tw = sr[1] - sr[0];
  const sL = [sr[0] + 0.16 * tw, shY];
  const sR = [sr[1] - 0.16 * tw, shY];
  // 손: 어깨~가랑이 아래 띠에서 가장 왼쪽/오른쪽 전경점. 몸에 붙어 있으면 몸 옆 아래로
  let minX = S;
  let maxX = -1;
  let minYs = [];
  let maxYs = [];
  for (let y = Math.round(shY); y <= Math.round(Math.min(y1 - 0.05 * H, crotchY + 0.15 * H)); y++) {
    for (let x = x0; x <= x1; x++) {
      if (!mask[y * S + x]) continue;
      if (x < minX) {
        minX = x;
        minYs = [y];
      } else if (x === minX) minYs.push(y);
      break;
    }
    for (let x = x1; x >= x0; x--) {
      if (!mask[y * S + x]) continue;
      if (x > maxX) {
        maxX = x;
        maxYs = [y];
      } else if (x === maxX) maxYs.push(y);
      break;
    }
  }
  const avg = (a) => a.reduce((p, q) => p + q, 0) / a.length;
  let hL = minYs.length ? [minX + 0.02 * W, avg(minYs)] : [sL[0] - 0.05 * W, hipY];
  let hR = maxYs.length ? [maxX - 0.02 * W, avg(maxYs)] : [sR[0] + 0.05 * W, hipY];
  if (hL[0] > sL[0] - 0.03 * W) hL = [sL[0] - 0.04 * W, hipY];
  if (hR[0] < sR[0] + 0.03 * W) hR = [sR[0] + 0.04 * W, hipY];
  const elbow = (s, h, side) => [(s[0] + h[0]) / 2 + side * 0.02 * W, (s[1] + h[1]) / 2];
  const neck = [neckRow.c ?? cx, neckY];
  return {
    head,
    neck,
    torso: [(neck[0] + hipX) / 2, neckY + (hipY - neckY) * 0.4],
    hip: [hipX, hipY],
    sL,
    eL: elbow(sL, hL, -1),
    hL,
    sR,
    eR: elbow(sR, hR, 1),
    hR,
    hipL,
    kL: [legX(hipL[0], fLx), kneeY],
    fL: [fLx, footY],
    hipR,
    kR: [legX(hipR[0], fRx), kneeY],
    fR: [fRx, footY],
  };
}

function quadJoints(mask, S, b) {
  const { x0, x1, y0, y1, W, H, cx } = b;
  const colTop = (x) => {
    x = Math.round(Math.max(x0, Math.min(x1, x)));
    for (let y = y0; y <= y1; y++) if (mask[y * S + x]) return y;
    return y0;
  };
  // 배 아래선: 줄 폭이 그림 폭의 절반을 넘는 가장 아래 줄
  let belly = Math.round(y0 + 0.6 * H);
  for (let y = y1; y >= y0; y--) {
    let n = 0;
    for (let x = x0; x <= x1; x++) n += mask[y * S + x];
    if (n >= 0.5 * W) {
      belly = y;
      break;
    }
  }
  belly = Math.min(belly, y1 - 0.12 * H);
  // 머리 쪽: 양 끝 25% 기둥 중 더 높이 올라간 쪽
  const topL = Math.min(...Array.from({ length: Math.max(1, Math.round(0.25 * W)) }, (_, i) => colTop(x0 + i)));
  const topR = Math.min(...Array.from({ length: Math.max(1, Math.round(0.25 * W)) }, (_, i) => colTop(x1 - i)));
  const dir = topR <= topL ? 1 : -1; // 머리가 +x 쪽이면 1
  // 다리: 발굽 위 띠(아래 6~16%)를 빈틈으로 나누고, 안 되면 맨 아래 띠로
  const bandXs = (ya, yb) => {
    const xs = [];
    for (let y = Math.round(ya); y <= Math.round(yb); y++) for (let x = x0; x <= x1; x++) if (mask[y * S + x]) xs.push(x);
    return xs;
  };
  const split = (xs) => (xs.length ? clusters(xs, Math.max(2, 0.015 * W)).filter((c) => c.n > xs.length * 0.04) : []);
  let cl = split(bandXs(y1 - 0.16 * H, y1 - 0.06 * H));
  if (cl.length < 2) cl = split(bandXs(y1 - 0.05 * H, y1));
  // 두 덩어리인데 각각 넓으면 앞다리 둘·뒷다리 둘이 붙어 보이는 것 → 덩어리마다 두 다리로 나눈다
  if (cl.length === 2 && cl.every((c) => c.b - c.a > 0.1 * W)) cl = cl.flatMap((c) => [{ c: c.a + (c.b - c.a) * 0.25 }, { c: c.b - (c.b - c.a) * 0.25 }]);
  let legs = cl.map((c) => c.c).sort((p, q) => (q - p) * dir); // 머리 쪽부터
  if (legs.length === 0) legs = [cx + dir * 0.3 * W, cx - dir * 0.3 * W];
  if (legs.length === 1) legs = [legs[0], cx - dir * 0.3 * W];
  let front;
  let hind;
  if (legs.length >= 4) {
    front = [legs[0], legs[1]];
    hind = [legs[legs.length - 2], legs[legs.length - 1]];
  } else {
    front = [legs[0], legs[0] - dir * 0.03 * W];
    hind = [legs[legs.length - 1], legs[legs.length - 1] + dir * 0.03 * W];
  }
  const footY = y1 - 0.02 * H;
  const kneeY = (belly + footY) / 2;
  const legPts = (x, k) => ({ [`${k}s`]: [x, belly - 0.08 * H], [`${k}k`]: [x, kneeY], [`${k}f`]: [x, footY] });
  const fmid = (front[0] + front[1]) / 2;
  const hmid = (hind[0] + hind[1]) / 2;
  const bodyMid = (x) => (colTop(x) + belly) / 2;
  const withers = [fmid, bodyMid(fmid)];
  const pelvis = [hmid, bodyMid(hmid)];
  // 머리: 머리 쪽 끝 15% 기둥의 위쪽 전경 무게중심
  let hx = 0;
  let hy = 0;
  let hn = 0;
  const xa = dir > 0 ? x1 - 0.15 * W : x0;
  const xb = dir > 0 ? x1 : x0 + 0.15 * W;
  for (let y = y0; y <= belly; y++)
    for (let x = Math.round(xa); x <= Math.round(xb); x++)
      if (mask[y * S + x]) {
        hx += x;
        hy += y;
        hn++;
      }
  const head = hn ? [hx / hn, hy / hn] : [dir > 0 ? x1 : x0, y0 + 0.2 * H];
  const neck = [(withers[0] + head[0]) / 2, Math.min(withers[1], head[1]) + Math.abs(withers[1] - head[1]) * 0.35];
  // 꼬리: 반대쪽 끝 기둥에서 가장 바깥 전경점
  const tx = dir > 0 ? x0 : x1;
  let tys = [];
  for (let y = y0; y <= belly; y++) if (mask[y * S + tx]) tys.push(y);
  const tail = tys.length ? [tx + dir * 0.02 * W, tys.reduce((p, q) => p + q, 0) / tys.length] : [pelvis[0] - dir * 0.08 * W, pelvis[1]];
  return { head, neck, withers, pelvis, tail, ...legPts(front[0], "fl"), ...legPts(front[1], "fr"), ...legPts(hind[0], "hl"), ...legPts(hind[1], "hr") };
}

// ── 뼈 가중치 ──
/** 마스크 안에서만 퍼지는 거리(지오데식): 팔과 몸통 사이에 빈틈이 있으면 팔 정점이 몸통 뼈에 끌려가지 않는다 */
function geodesic(m, G, seeds) {
  const N = G * G;
  const dist = new Float64Array(N).fill(Infinity);
  // 정수 칸 번호와 거리를 담는 이진 힙 (배열 객체를 만들지 않아 빠르다)
  let cap = N * 4 + 16;
  let hk = new Float64Array(cap);
  let hi = new Int32Array(cap);
  let n = 0;
  const push = (d, i) => {
    if (n >= cap) {
      cap *= 2;
      const k2 = new Float64Array(cap);
      k2.set(hk);
      hk = k2;
      const i2 = new Int32Array(cap);
      i2.set(hi);
      hi = i2;
    }
    let k = n++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hk[p] <= d) break;
      hk[k] = hk[p];
      hi[k] = hi[p];
      k = p;
    }
    hk[k] = d;
    hi[k] = i;
  };
  for (const [i, d] of seeds)
    if (d < dist[i]) {
      dist[i] = d;
      push(d, i);
    }
  const DX = [1, -1, 0, 0, 1, 1, -1, -1];
  const DY = [0, 0, 1, -1, 1, -1, 1, -1];
  const DW = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
  while (n > 0) {
    const d = hk[0];
    const i = hi[0];
    n--;
    if (n > 0) {
      const ld = hk[n];
      const li = hi[n];
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && hk[r] < hk[l] ? r : l;
        if (hk[c] >= ld) break;
        hk[k] = hk[c];
        hi[k] = hi[c];
        k = c;
      }
      hk[k] = ld;
      hi[k] = li;
    }
    if (d > dist[i]) continue;
    const x = i % G;
    const y = (i / G) | 0;
    for (let t = 0; t < 8; t++) {
      const nx = x + DX[t];
      const ny = y + DY[t];
      if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
      const j = ny * G + nx;
      if (!m[j]) continue;
      const nd = d + DW[t];
      if (nd < dist[j]) {
        dist[j] = nd;
        push(nd, j);
      }
    }
  }
  return dist;
}

function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const L = vx * vx + vy * vy || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L));
  return Math.hypot(px - ax - vx * t, py - ay - vy * t);
}

/**
 * 정점마다 가장 가까운 뼈 2개와 가중치. uv: Float32Array(n*2). 반환 skinIndex/skinWeight는 정점당 4칸(three.js 형식).
 * 거리는 그림(마스크) 안에서 잰다. 마스크 밖 정점(테두리)은 가장 가까운 마스크 칸으로 옮겨 잰다.
 */
export function computeSkin({ uv, mask, S, joints, templateId, G = 128 }) {
  const tpl = TEMPLATES[templateId];
  const n = uv.length / 2;
  const m = new Uint8Array(G * G);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) m[y * G + x] = mask[Math.floor(((y + 0.5) * S) / G) * S + Math.floor(((x + 0.5) * S) / G)];
  // 마스크 밖 칸 → 가장 가까운 마스크 칸 (BFS)
  const near = new Int32Array(G * G).fill(-1);
  const q = [];
  for (let i = 0; i < G * G; i++)
    if (m[i]) {
      near[i] = i;
      q.push(i);
    }
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    const x = i % G;
    const y = (i / G) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
      const j = ny * G + nx;
      if (near[j] >= 0) continue;
      near[j] = near[i];
      q.push(j);
    }
  }
  if (!q.length) throw new Error("빈 마스크");
  const cell = (ix, iy) => {
    const x = Math.max(0, Math.min(G - 1, Math.floor(ix * G)));
    const y = Math.max(0, Math.min(G - 1, Math.floor(iy * G)));
    return near[y * G + x];
  };
  // 뼈마다 거리장
  const fields = tpl.bones.map((bone) => {
    const seeds = [];
    for (const [a, c] of bone.segs) {
      const [ax, ay] = pointOf(joints, a).map((v) => v * G);
      const [bx, by] = pointOf(joints, c).map((v) => v * G);
      const len = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.ceil(len * 2));
      for (let s = 0; s <= steps; s++) {
        const px = ax + ((bx - ax) * s) / steps;
        const py = ay + ((by - ay) * s) / steps;
        const xi = Math.floor(px);
        const yi = Math.floor(py);
        if (xi >= 0 && yi >= 0 && xi < G && yi < G && m[yi * G + xi]) seeds.push([yi * G + xi, 0]);
      }
      if (!seeds.length) {
        const j = cell((ax + bx) / 2 / G, (ay + by) / 2 / G);
        seeds.push([j, Math.hypot((j % G) - (ax + bx) / 2, ((j / G) | 0) - (ay + by) / 2)]);
      }
    }
    return { f: geodesic(m, G, seeds), weak: !!bone.weak };
  });
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const sigma = 0.025 * G; // 관절 근처에서 두 뼈가 섞이는 폭
  for (let v = 0; v < n; v++) {
    const ix = uv[v * 2];
    const iy = 1 - uv[v * 2 + 1];
    const c = cell(ix, iy);
    let b1 = 0;
    let d1 = Infinity;
    let b2 = 0;
    let d2 = Infinity;
    for (let k = 0; k < fields.length; k++) {
      let d = fields[k].f[c];
      if (fields[k].weak) d *= 1.6; // 꼬리처럼 얇은 뼈는 덜 끌어간다
      if (d < d1) {
        b2 = b1;
        d2 = d1;
        b1 = k;
        d1 = d;
      } else if (d < d2) {
        b2 = k;
        d2 = d;
      }
    }
    const e = Number.isFinite(d2) ? Math.exp(-(d2 - d1) / sigma) : 0;
    skinIndex[v * 4] = b1;
    skinIndex[v * 4 + 1] = b2;
    skinWeight[v * 4] = 1 / (1 + e);
    skinWeight[v * 4 + 1] = e / (1 + e);
  }
  return { skinIndex, skinWeight, bones: tpl.bones.map((b) => b.name) };
}

/** UV(그림 위치) → 메시 좌표 1차 근사 (최소제곱). 관절의 3D 위치(두께 가운데)를 얻는다 */
export function fitAffine(uv, pos) {
  const n = uv.length / 2;
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const B = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    const u = uv[i * 2];
    const v = uv[i * 2 + 1];
    if (u === 0 && v === 0) continue; // 쓰레기 조각에 붙은 빈 UV
    const r = [u, v, 1];
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) A[a][b] += r[a] * r[b];
      for (let k = 0; k < 3; k++) B[a][k] += r[a] * pos[i * 3 + k];
    }
  }
  const inv = inv3(A);
  const M = [0, 1, 2].map((k) => [0, 1, 2].map((a) => inv[a][0] * B[0][k] + inv[a][1] * B[1][k] + inv[a][2] * B[2][k]));
  // M[k] = 좌표 k의 [u계수, v계수, 상수]
  return (ix, iy) => {
    const u = ix;
    const v = 1 - iy;
    return M.map(([a, b, c]) => a * u + b * v + c);
  };
}
function inv3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C || 1e-12;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}
