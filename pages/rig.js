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
/** 거리 변환(체임퍼 3-4): 각 전경 점에서 가장 가까운 배경까지의 거리(픽셀) */
function distMap(mask, S) {
  const INF = 1e9;
  const d = new Float32Array(S * S);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  const g = (x, y) => (x < 0 || y < 0 || x >= S || y >= S ? 0 : d[y * S + x]);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], g(x - 1, y) + 3, g(x, y - 1) + 3, g(x - 1, y - 1) + 4, g(x + 1, y - 1) + 4);
    }
  for (let y = S - 1; y >= 0; y--)
    for (let x = S - 1; x >= 0; x--) {
      const i = y * S + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], g(x + 1, y) + 3, g(x, y + 1) + 3, g(x + 1, y + 1) + 4, g(x - 1, y + 1) + 4);
    }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}
/** 상자 안에서 거리 변환이 가장 큰 점 {x, y, r}. weight(x, y)로 위쪽 등을 더 쳐줄 수 있다 */
function deepest(dt, S, xa, xb, ya, yb, weight = () => 1) {
  let best = null;
  for (let y = Math.max(0, Math.round(ya)); y <= Math.min(S - 1, Math.round(yb)); y++)
    for (let x = Math.max(0, Math.round(xa)); x <= Math.min(S - 1, Math.round(xb)); x++) {
      const r = dt[y * S + x];
      if (!r) continue;
      const sc = r * weight(x, y);
      if (!best || sc > best.sc) best = { x, y, r, sc };
    }
  return best;
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
export function estimateJoints(mask, S, templateId, { ink = null } = {}) {
  const b = bbox(mask, S);
  if (!b) return null;
  const J = templateId === "quad" ? quadJoints(mask, S, b, ink) : humanJoints(mask, S, b);
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
  // 머리: 위쪽 42% 안에서 가장 '두꺼운' 점(그림 안쪽으로 가장 깊은 점 = 거리 변환 최댓값).
  // 맨 위 점을 머리로 잡으면 토끼 귀·머리카락 꼭대기에 찍히므로, 둥근 덩어리의 가운데를 찾는다.
  // 목은 그 덩어리 아래 가장자리(가운데 + 반지름) 근처
  const dt = distMap(mask, S);
  // 위에서부터 줄마다 가장 두꺼운 값을 보며 내려가다, 두께가 크게 줄어드는(목) 첫 봉우리가 머리.
  // 목이 없이 몸으로 이어지는 그림이면 위쪽 42% 안에서 (위쪽을 조금 더 쳐서) 가장 두꺼운 점
  let blob = null;
  {
    let run = null;
    for (let y = y0; y <= y0 + 0.55 * H; y++) {
      const m = deepest(dt, S, x0, x1, y, y);
      if (!m) continue;
      if (!run || m.r > run.r) run = m;
      else if (run.r >= 0.05 * H && m.r < 0.7 * run.r) {
        blob = run;
        break;
      }
    }
  }
  if (!blob) blob = deepest(dt, S, x0, x1, y0, y0 + 0.42 * H, (x, y) => 1 - (0.5 * (y - y0)) / H);
  let head;
  if (blob && blob.r >= 0.05 * H) {
    head = [blob.x, blob.y];
    const ny = Math.min(y0 + 0.55 * H, blob.y + blob.r * 1.05);
    const nr = runAt(mask, S, ny, blob.x);
    neckRow = { y: ny, c: nr ? Math.max(nr[0], Math.min(nr[1], blob.x)) : blob.x };
  }
  const neckY = neckRow.y;
  if (!head) {
    const headMid = runAt(mask, S, (y0 + neckY) / 2, cx);
    head = [headMid ? (headMid[0] + headMid[1]) / 2 : cx, (y0 + neckY) / 2];
  }

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
    // 두 다리를 각각 따라 올라가다 한 구간으로 만나는 줄 (벌린 다리는 비스듬해서, 발 사이 전체를 보면 팔 높이까지 올라가 버린다)
    let lx = fLx;
    let rx = fRx;
    let met = null;
    for (; y > y0; y--) {
      const rl = runAt(mask, S, y, lx);
      const rr = runAt(mask, S, y, rx);
      if (!rl || !rr) break;
      if (rl[0] === rr[0]) {
        met = y;
        break;
      }
      lx = (rl[0] + rl[1]) / 2;
      rx = (rr[0] + rr[1]) / 2;
    }
    crotchY = met ?? y;
  }
  crotchY = Math.min(y1 - 0.12 * H, Math.max(neckY + 0.3 * (y1 - neckY), crotchY));
  const hipY = crotchY - 0.03 * H;
  const hipRun = runAt(mask, S, hipY, cx);
  const hipX = hipRun ? (hipRun[0] + hipRun[1]) / 2 : cx;
  // 엉덩이는 골반 줄의 몸 안쪽에 둔다 (다리를 크게 벌린 막대 인형에서 몸 밖 허공에 찍히지 않게)
  const hl = hipRun ? hipRun[0] : -Infinity;
  const hr = hipRun ? hipRun[1] : Infinity;
  const hipL = [Math.min(hipX, Math.max(hl, hipX + (fLx - hipX) * 0.55)), hipY];
  const hipR = [Math.max(hipX, Math.min(hr, hipX + (fRx - hipX) * 0.55)), hipY];
  const kneeY = (hipY + footY) / 2;
  const legX = (hx, fx) => {
    const r = runAt(mask, S, kneeY, (hx + fx) / 2);
    return r ? (r[0] + r[1]) / 2 : (hx + fx) / 2;
  };
  // 어깨: 목 조금 아래 줄의 몸통 구간 양쪽 안쪽
  const shY = neckY + 0.06 * H;
  // 어깨 줄에는 옆으로 뻗은 팔이 붙어 있을 수 있어, 몸통 폭은 목과 골반 사이(팔 아래) 줄에서 잰다
  const sr0 = runAt(mask, S, shY + 0.02 * H, cx) || [cx - 0.15 * W, cx + 0.15 * W];
  const mr = runAt(mask, S, neckY + 0.5 * (hipY - neckY), cx);
  const sr = mr && mr[1] - mr[0] < sr0[1] - sr0[0] ? [Math.max(sr0[0], mr[0]), Math.min(sr0[1], mr[1])] : sr0;
  const scx = (sr[0] + sr[1]) / 2;
  const tw = sr[1] - sr[0];
  const sL = [scx - 0.36 * tw, shY];
  const sR = [scx + 0.36 * tw, shY];
  // 손: 어깨~가랑이 아래 띠에서 가장 왼쪽/오른쪽 전경점. 몸에 붙어 있으면 몸 옆 아래로
  let minX = S;
  let maxX = -1;
  let minYs = [];
  let maxYs = [];
  // 손은 골반보다 조금 아래까지만 찾는다: 더 내려가면 옆으로 벌린 다리 끝을 손으로 잡는다
  for (let y = Math.round(shY); y <= Math.round(Math.min(y1 - 0.05 * H, hipY + 0.05 * H)); y++) {
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
  // 팔꿈치: 어깨~손 가운데. 팔이 굽어 그 점이 몸 밖이면 가장 가까운 그림 위 점으로 옮긴다
  const snap = (p) => {
    if (at(p[0], p[1])) return p;
    const R = Math.round(0.08 * W);
    let best = p;
    let bd = Infinity;
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const d = dx * dx + dy * dy;
        if (d < bd && at(p[0] + dx, p[1] + dy)) {
          bd = d;
          best = [p[0] + dx, p[1] + dy];
        }
      }
    return best;
  };
  const elbow = (s, h, side) => snap([(s[0] + h[0]) / 2 + side * 0.02 * W, (s[1] + h[1]) / 2]);
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

/** y행에서 x0..x1 사이 전경 구간들의 가운데 x */
function runsAt(m, S, y, x0, x1) {
  const out = [];
  for (let x = x0; x <= x1; ) {
    if (!m[y * S + x]) {
      x++;
      continue;
    }
    let e = x;
    while (e + 1 <= x1 && m[y * S + e + 1]) e++;
    out.push((x + e) / 2);
    x = e + 1;
  }
  return out;
}

/**
 * 다리가 붙어 한 덩어리로 보일 때(발끝이 옆 다리에 닿아 다리 사이가 채워짐) 선(잉크)만 보고 다리를 센다.
 * 다리 중간 높이 줄에서 선이 8개면 윤곽선 다리 4개(두 선씩 짝), 4개면 다리 4개. 안 되면 null.
 */
function legsFromInk(ink, S, x0, x1, ya, yb) {
  const votes = new Map();
  for (let y = Math.round(ya); y <= Math.round(yb); y++) {
    const r = runsAt(ink, S, y, x0, x1);
    if (r.length !== 8 && r.length !== 4) continue;
    const legs = r.length === 8 ? [0, 2, 4, 6].map((i) => (r[i] + r[i + 1]) / 2) : r;
    const k = r.length;
    if (!votes.has(k)) votes.set(k, []);
    votes.get(k).push(legs);
  }
  // 더 많은 줄에서 나온 쪽, 같으면 8(윤곽선)
  let best = null;
  for (const [k, list] of votes) if (!best || list.length > best.list.length || (list.length === best.list.length && k === 8)) best = { k, list };
  if (!best || best.list.length < 2) return null;
  return [0, 1, 2, 3].map((i) => best.list.reduce((s, l) => s + l[i], 0) / best.list.length);
}

function quadJoints(mask, S, b, ink = null) {
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
  let dir = topR <= topL ? 1 : -1; // 머리가 +x 쪽이면 1
  // 목을 세운 그림: 가장 높이 솟은 부분(위 20% 안에 드는 기둥들)이 좁게 몰려 있으면 그게 머리
  let raised = null;
  let raisedSpan = null;
  {
    let ra = Infinity;
    let rb = -Infinity;
    for (let x = x0; x <= x1; x++) {
      if (colTop(x) <= y0 + 0.2 * H) {
        ra = Math.min(ra, x);
        rb = Math.max(rb, x);
      }
    }
    if (rb - ra <= 0.5 * W) {
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let y = y0; y <= y0 + 0.3 * H; y++)
        for (let x = ra; x <= rb; x++)
          if (mask[y * S + x]) {
            sx += x;
            sy += y;
            n++;
          }
      if (n) {
        raised = [sx / n, sy / n];
        raisedSpan = [ra, rb];
        dir = raised[0] >= cx ? 1 : -1;
      }
    }
  }
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
  let legs = cl.map((c) => c.c);
  if (legs.length < 4) {
    // 다리 사이가 메워져 덩어리가 적게 나오면: 선(잉크)으로 세고, 그래도 안 되면 다리 띠 폭에 고르게 4개
    const ya = belly + 0.25 * (y1 - belly);
    const yb = belly + 0.6 * (y1 - belly);
    const byInk = ink ? legsFromInk(ink, S, x0, x1, ya, yb) : null;
    if (byInk) legs = byInk;
    else {
      const xs = bandXs(ya, yb);
      if (xs.length) {
        xs.sort((p, q) => p - q);
        const a = xs[Math.floor(xs.length * 0.03)];
        const c = xs[Math.floor(xs.length * 0.97)];
        if (c - a > 0.35 * W) legs = [0.1, 0.35, 0.65, 0.9].map((t) => a + (c - a) * t);
      }
    }
  }
  legs.sort((p, q) => (q - p) * dir); // 머리 쪽부터
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
  // 어깨(등): 앞다리 위에서 몸통 쪽으로 조금 들어간 곳의 몸통 가운데 (앞다리 바로 위가 머리면 얼굴에 찍히므로)
  // 등선: 앞·뒷다리 사이 기둥들 윗면의 중앙값. 큰 머리·세운 목 기둥은 등보다 높으므로 등선 아래로 내려 잡는다
  const tops = [];
  for (let x = Math.round(Math.min(fmid, hmid)); x <= Math.round(Math.max(fmid, hmid)); x++) tops.push(colTop(x));
  tops.sort((p, q) => p - q);
  const backY = tops.length ? tops[tops.length >> 1] : y0;
  const wx = fmid + (hmid - fmid) * 0.15;
  const withers = [wx, (Math.max(colTop(wx), backY) + belly) / 2];
  const pelvis = [hmid, (Math.max(colTop(hmid), backY) + belly) / 2];

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
  // 머리: 머리 쪽(솟은 부분 주변, 아니면 머리 쪽 끝 35%)에서 배 위로 가장 두꺼운 점 = 둥근 머리의 가운데 (귀 끝 말고)
  const qdt = distMap(mask, S);
  const hxa = raised ? Math.min(raisedSpan[0], raised[0] - 0.15 * W) : dir > 0 ? x1 - 0.35 * W : x0;
  const hxb = raised ? Math.max(raisedSpan[1], raised[0] + 0.15 * W) : dir > 0 ? x1 : x0 + 0.35 * W;
  const hb = deepest(qdt, S, hxa, hxb, y0, raised ? y0 + 0.6 * (belly - y0) : belly, (x, y) => 1 - (0.4 * (y - y0)) / H);
  const head = hb ? [hb.x, hb.y] : raised || (hn ? [hx / hn, hy / hn] : [dir > 0 ? x1 : x0, y0 + 0.2 * H]);
  const neck = hb
    ? [head[0] + (withers[0] - head[0]) * 0.5, head[1] + (withers[1] - head[1]) * 0.5]
    : [(withers[0] + head[0]) / 2, Math.min(withers[1], head[1]) + Math.abs(withers[1] - head[1]) * 0.35];
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
