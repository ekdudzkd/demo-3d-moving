// 6방향 뷰 편집 코어 (DOM 없음, Node에서도 테스트 가능).
//
// backend/app/edit 의 규칙을 그대로 옮긴 것이다.
//   basis.json  패널 기준표 (Python과 같은 파일, 배포 때 pages/로 복사)
//   ops.py      world op 선형 변환·역연산
//   compose.py  합성·바닥 맞춤·stand_up·화면 op → 월드 op·범위 검사
//   versions.py append-only 버전, undo/revert = 목적지 op를 복사한 새 버전
// 기대값은 backend/tests/fixtures/edit_cases.json 하나를 Python·JS가 함께 검사한다.

import { buildCollider, inspectMesh, weldMap } from "./pipeline.js";

export const MIN_FACTOR = 0.1;
export const MAX_FACTOR = 10.0;
export const MAX_RATIO = 20.0;
const UPRIGHT_TOLERANCE = 0.02;
const CENTROID_TOLERANCE = 0.02;
const AXES = "xyz";
export const PANEL_ORDER = ["front", "back", "left", "right", "top", "bottom"];
export const PANEL_NAMES = { front: "정면", back: "뒤", left: "왼쪽", right: "오른쪽", top: "위", bottom: "아래" };
// 월드에서 W로 갈 수 있는 앞쪽 후보 (위·아래는 바닥과 평행하지 않아 제외)
export const HEADING_PANELS = ["front", "back", "left", "right"];

/**
 * 앞쪽 패널의 바깥 방향(toward_viewer)을 모델 로컬 +X(월드 이동 코드의 진행 방향)로 돌리는 y축 회전각.
 * three.js rotation.y = θ 는 (x, z) → (x cosθ + z sinθ, −x sinθ + z cosθ).
 */
export function headingRotation(panels, heading) {
  const t = panels[heading].toward_viewer;
  return -Math.atan2(-t[2], t[0]);
}

/** 앞쪽 회전 뒤 충돌 상자 반치수 [x, z] (90° 단위라 축이 서로 바뀔 뿐) */
export function headingHalfExtents(half, theta) {
  return Math.abs(Math.sin(theta)) > 0.5 ? [half[2], half[0]] : [half[0], half[2]];
}


// ---------------------------------------------------------------------------
// 3×3 행렬 (행 우선 배열)
// ---------------------------------------------------------------------------
const eye = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const matmul = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
const det = (m) =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
// numpy.allclose 기본값 (rtol 1e-5, atol 1e-8)
const allclose = (a, b) => a.every((row, i) => row.every((x, j) => Math.abs(x - b[i][j]) <= 1e-8 + 1e-5 * Math.abs(b[i][j])));

/** 부호 있는 월드 단위축 → [축 번호, 부호] */
function axisIndex(vec) {
  let i = 0;
  for (let k = 1; k < 3; k++) if (Math.abs(vec[k]) > Math.abs(vec[i])) i = k;
  return [i, Math.sign(vec[i])];
}

/** +axis 기준 오른손 법칙 k×90° 회전 (정수 행렬) */
export function rotationMatrix(axis, k) {
  const [c, s] = [[1, 0], [0, 1], [-1, 0], [0, -1]][((k % 4) + 4) % 4];
  const [a, b] = [[1, 2], [2, 0], [0, 1]][axis];
  const m = eye();
  m[a][a] = c;
  m[a][b] = -s;
  m[b][a] = s;
  m[b][b] = c;
  return m;
}

export function inverse(op) {
  if (op.op === "rotate") return { op: "rotate", axis: op.axis, k: -op.k };
  if (op.op === "scale") return { op: "scale", factors: op.factors.map((f) => 1 / f) };
  if (op.op === "mirror") return { ...op };
  // 두께 단면 op는 정점마다 곱하는 배율이라 역연산 = 역수 (D-029)
  if (op.op === "round") return { ...op, power: -(op.power ?? 1) };
  if (op.op === "taper") return { ...op, ratio: 1 / op.ratio };
  throw new Error(`역연산이 없는 op: ${op.op}`);
}

// ---------------------------------------------------------------------------
// 두께 단면 (D-029): v0 물체 좌표의 두께 축(z, 입력 그림 시선 방향)에 정점별 배율을 곱한다
// ---------------------------------------------------------------------------
const PROFILE_OPS = new Set(["round", "taper"]);
const FIELD = 96;
const depthCache = new WeakMap();

/**
 * v0을 xy(입력 그림 평면)로 투영한 실루엣에서 경계까지 거리. 정점마다 0(경계)~1(가장 안쪽).
 * 투영 삼각형을 격자에 칠하고 chamfer(3-4) 거리 변환으로 구한다.
 */
export function silhouetteDepth(v0) {
  const hit = depthCache.get(v0);
  if (hit) return hit;
  const { v, f } = v0;
  const [lo, hi] = meshBounds(v0);
  const cell = Math.max(hi[0] - lo[0], hi[1] - lo[1], 1e-9) / (FIELD - 4);
  const ox = lo[0] - 2 * cell;
  const oy = lo[1] - 2 * cell;
  const inside = new Uint8Array(FIELD * FIELD);
  for (let i = 0; i < f.length; i += 3) {
    const ax = (v[f[i] * 3] - ox) / cell, ay = (v[f[i] * 3 + 1] - oy) / cell;
    const bx = (v[f[i + 1] * 3] - ox) / cell, by = (v[f[i + 1] * 3 + 1] - oy) / cell;
    const cx = (v[f[i + 2] * 3] - ox) / cell, cy = (v[f[i + 2] * 3 + 1] - oy) / cell;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(FIELD - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(FIELD - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) inside[y * FIELD + x] = 1;
      }
    }
  }
  const INF = 1e9;
  const d = new Float64Array(FIELD * FIELD);
  for (let i = 0; i < d.length; i++) d[i] = inside[i] ? INF : 0;
  const relax = (x, y, dx, dy, w) => {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= FIELD || ny >= FIELD) return;
    const i = y * FIELD + x;
    d[i] = Math.min(d[i], d[ny * FIELD + nx] + w);
  };
  for (let y = 0; y < FIELD; y++) {
    for (let x = 0; x < FIELD; x++) {
      relax(x, y, -1, 0, 3); relax(x, y, 0, -1, 3); relax(x, y, -1, -1, 4); relax(x, y, 1, -1, 4);
    }
  }
  for (let y = FIELD - 1; y >= 0; y--) {
    for (let x = FIELD - 1; x >= 0; x--) {
      relax(x, y, 1, 0, 3); relax(x, y, 0, 1, 3); relax(x, y, 1, 1, 4); relax(x, y, -1, 1, 4);
    }
  }
  const n = v.length / 3;
  const out = new Float64Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const gx = Math.min(FIELD - 1, Math.max(0, Math.floor((v[i * 3] - ox) / cell)));
    const gy = Math.min(FIELD - 1, Math.max(0, Math.floor((v[i * 3 + 1] - oy) / cell)));
    out[i] = Math.max(0, d[gy * FIELD + gx] / 3 - 0.5); // 칸 중심 → 경계 정점은 0 근처
    max = Math.max(max, out[i]);
  }
  for (let i = 0; i < n; i++) out[i] = max > 0 ? out[i] / max : 0;
  depthCache.set(v0, out);
  return out;
}

/** 단면 op들의 정점별 두께 배율 (없으면 null). round: 경계 거리 기반, taper: 물체 축 위치 기반 기하 배율 */
export function profileField(v0, ops) {
  const prof = ops.filter((o) => PROFILE_OPS.has(o.op));
  if (!prof.length) return null;
  const n = v0.v.length / 3;
  const m = new Float64Array(n).fill(1);
  const [lo, hi] = meshBounds(v0);
  for (const op of prof) {
    if (op.op === "round") {
      const t = silhouetteDepth(v0);
      const p = op.power ?? 1;
      for (let i = 0; i < n; i++) {
        const g = Math.sqrt(Math.max(0, 1 - (1 - t[i]) ** 2)); // 둥근 단면 (경계 0 → 안쪽 1)
        const base = op.mode === "bulge" ? 1 + op.amount * g : 1 - op.amount + op.amount * g;
        m[i] *= base ** p;
      }
    } else {
      const k = AXES.indexOf(op.axis);
      const span = hi[k] - lo[k] || 1;
      for (let i = 0; i < n; i++) m[i] *= op.ratio ** ((v0.v[i * 3 + k] - lo[k]) / span - 0.5);
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// 메시 도구 ({v: Float64Array, f: Uint32Array, c: Float32Array} — pipeline.js 형식)
// ---------------------------------------------------------------------------
export function meshBounds(mesh) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.v.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], mesh.v[i + k]);
      hi[k] = Math.max(hi[k], mesh.v[i + k]);
    }
  }
  return [lo, hi];
}

export function extents(mesh) {
  const [lo, hi] = meshBounds(mesh);
  return [0, 1, 2].map((k) => hi[k] - lo[k]);
}

/** 위치 기준으로 모든 변이 정확히 두 면에 쓰이는지 (trimesh is_watertight 대응) */
function isClosed(mesh) {
  const { map } = weldMap(mesh.v);
  const count = new Map();
  for (let i = 0; i < mesh.f.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = map[mesh.f[i + e]];
      const b = map[mesh.f[i + ((e + 1) % 3)]];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  for (const n of count.values()) if (n !== 2) return false;
  return count.size > 0;
}

/** 닫힌 메시(부피 양수)는 부피 중심, 아니면 면적 가중 중심 (compose.py centroid) */
export function centroid(mesh) {
  const { v, f } = mesh;
  let vol = 0;
  const cv = [0, 0, 0];
  let area = 0;
  const ca = [0, 0, 0];
  for (let i = 0; i < f.length; i += 3) {
    const a = [v[f[i] * 3], v[f[i] * 3 + 1], v[f[i] * 3 + 2]];
    const b = [v[f[i + 1] * 3], v[f[i + 1] * 3 + 1], v[f[i + 1] * 3 + 2]];
    const c = [v[f[i + 2] * 3], v[f[i + 2] * 3 + 1], v[f[i + 2] * 3 + 2]];
    const t = (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const s = Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
    vol += t;
    area += s;
    for (let k = 0; k < 3; k++) {
      cv[k] += (t * (a[k] + b[k] + c[k])) / 4;
      ca[k] += (s * (a[k] + b[k] + c[k])) / 3;
    }
  }
  if (vol > 1e-12 && isClosed(mesh)) return cv.map((x) => x / vol);
  return ca.map((x) => x / Math.max(area, 1e-12));
}

const ratio = (e) => (Math.min(...e) <= 0 ? Infinity : Math.max(...e) / Math.min(...e));

// ---------------------------------------------------------------------------
// 코어 (basis.json을 받아 만든다)
// ---------------------------------------------------------------------------
export function createEditCore(basis) {
  const panels = basis.panels;

  function linear(op) {
    if (PROFILE_OPS.has(op.op)) return eye(); // 두께 단면은 선형 변환 전에 v0에서 따로 적용
    if (op.op === "label") {
      const p = panels[op.label];
      const cols = [p.screen_right, p.screen_up, p.toward_viewer];
      return [0, 1, 2].map((i) => cols.map((col) => col[i]));
    }
    if (op.op === "rotate") return rotationMatrix(AXES.indexOf(op.axis), op.k);
    if (op.op === "scale") return [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? op.factors[i] : 0)));
    if (op.op === "mirror") {
      const m = eye();
      const i = AXES.indexOf(op.axis);
      m[i][i] = -1;
      return m;
    }
    throw new Error(`알 수 없는 op: ${op.op}`);
  }

  /** 앞에서부터 차례로 적용한 3×3 선형 변환 */
  function compose(ops) {
    let m = eye();
    for (const op of ops) m = matmul(linear(op), m);
    return m;
  }

  /** v0에 op 리스트를 적용하고 xz 중앙·y=0 바닥에 맞춘 새 메시. 두께 단면을 먼저, 그다음 선형 변환. 반전이면 면 감김을 뒤집는다. */
  function apply(v0, ops) {
    const m = compose(ops);
    const field = profileField(v0, ops);
    const [lo0, hi0] = meshBounds(v0);
    const zc = (lo0[2] + hi0[2]) / 2;
    const n = v0.v.length / 3;
    const v = new Float64Array(v0.v.length);
    for (let i = 0; i < n; i++) {
      const x = v0.v[i * 3];
      const y = v0.v[i * 3 + 1];
      const z = field ? zc + (v0.v[i * 3 + 2] - zc) * field[i] : v0.v[i * 3 + 2];
      for (let k = 0; k < 3; k++) v[i * 3 + k] = m[k][0] * x + m[k][1] * y + m[k][2] * z;
    }
    const [lo, hi] = meshBounds({ v });
    const off = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
    for (let i = 0; i < v.length; i++) v[i] -= off[i % 3];
    const f = Uint32Array.from(v0.f);
    if (det(m) < 0) {
      for (let i = 0; i < f.length; i += 3) [f[i], f[i + 2]] = [f[i + 2], f[i]];
    }
    return { v, f, c: v0.c ? v0.c.slice() : new Float32Array(v.length) };
  }

  /** e0 물체 축 기준 누적 배율 (= 사용자 op 합성 행렬의 열 길이) */
  function userFactors(ops) {
    const m = compose(ops.filter((o) => o.op !== "label"));
    return [0, 1, 2].map((j) => Math.hypot(m[0][j], m[1][j], m[2][j]));
  }

  const extentsOf = (base, m) => m.map((row) => Math.abs(row[0]) * base[0] + Math.abs(row[1]) * base[1] + Math.abs(row[2]) * base[2]);

  /** 가장 긴 축을 y로 세우는 90° 회전. 무거운 쪽이 아래로 가는 방향을 고른다. */
  function standUp(mesh) {
    const e = extents(mesh);
    if (e[1] >= Math.max(...e) * (1 - UPRIGHT_TOLERANCE)) return [null, null];
    const longest = e[0] >= e[2] * (1 - UPRIGHT_TOLERANCE) ? 0 : 2;
    const axis = longest === 0 ? 2 : 0;
    const c = centroid(mesh);
    const scores = {};
    for (const k of [1, -1]) {
      const r = linear({ op: "rotate", axis: AXES[axis], k })[1];
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < mesh.v.length; i += 3) {
        const y = mesh.v[i] * r[0] + mesh.v[i + 1] * r[1] + mesh.v[i + 2] * r[2];
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
      scores[k] = (c[0] * r[0] + c[1] * r[1] + c[2] * r[2] - (lo + hi) / 2) / Math.max(e[longest], 1e-12);
    }
    if (Math.abs(scores[1] - scores[-1]) < CENTROID_TOLERANCE) {
      return [{ op: "rotate", axis: AXES[axis], k: 1 }, "거꾸로 섰다면 '뒤집어줘'라고 하세요."];
    }
    return [{ op: "rotate", axis: AXES[axis], k: scores[1] <= scores[-1] ? 1 : -1 }, null];
  }

  function screenOp(op, panel) {
    if (op.type === "scale_uniform") return { op: "scale", factors: [op.factor, op.factor, op.factor] };
    const [i, sign] = axisIndex(panels[panel][op.axis]);
    if (op.type === "rotate90") return { op: "rotate", axis: AXES[i], k: op.k * sign };
    if (op.type === "scale_axis") {
      const factors = [1, 1, 1];
      factors[i] = op.factor;
      return { op: "scale", factors };
    }
    if (op.type === "mirror") return { op: "mirror", axis: AXES[i] };
    throw new Error(`알 수 없는 화면 op: ${op.type}`);
  }

  /** 화면 op → 활성 버전 뒤에 붙일 월드 op. 범위·no-op 검사까지 (compose.py resolve) */
  function resolve(screenOps, panel, activeOps, v0) {
    const ops = [...activeOps];
    const added = [];
    const notes = [];
    let alreadyUp = false;
    for (const sop of screenOps) {
      let made;
      if (sop.type === "stand_up") {
        const [op, note] = standUp(apply(v0, ops));
        if (!op) {
          alreadyUp = true;
          continue;
        }
        if (note) notes.push(note);
        made = [op];
      } else if (sop.type === "invert_last") {
        const user = ops.filter((o) => o.op !== "label");
        if (!user.length) return { kind: "refuse", ops: [], reason_code: "nothing_to_invert", message: "되돌릴 편집이 없어요.", notes: [] };
        made = [inverse(user[user.length - 1])];
      } else if (sop.type === "round") {
        made = [{ op: "round", mode: sop.mode, amount: sop.amount }];
      } else if (sop.type === "flatten") {
        // 지금까지의 둥글게·볼록하게를 모두 상쇄 (같은 모양끼리 지수를 더해 0으로)
        const net = new Map();
        for (const o of ops.filter((x) => x.op === "round")) {
          const key = `${o.mode}:${o.amount}`;
          net.set(key, { mode: o.mode, amount: o.amount, power: (net.get(key)?.power ?? 0) + (o.power ?? 1) });
        }
        made = [...net.values()].filter((r) => Math.abs(r.power) > 1e-9).map((r) => ({ op: "round", mode: r.mode, amount: r.amount, power: -r.power }));
      } else if (sop.type === "taper") {
        // 패널 화면 축 → 현재 선형 변환의 역으로 물체 축 (부호 있는 축 치환×대각이라 Mᵀw의 방향과 같다)
        const m = compose(ops);
        const w = panels[panel][sop.axis];
        const [i, sign] = axisIndex([0, 1, 2].map((j) => m[0][j] * w[0] + m[1][j] * w[1] + m[2][j] * w[2]));
        if (i === 2) {
          return {
            kind: "refuse",
            ops: [],
            reason_code: "out_of_scope",
            message: `${PANEL_NAMES[panel]} 패널에서 그 방향은 두께 방향이라 두께가 달라질 수 없어요. 두께가 보이는 옆 패널에서 말해 주세요.`,
            notes: [],
          };
        }
        made = [{ op: "taper", axis: AXES[i], ratio: sign > 0 ? sop.ratio : 1 / sop.ratio }];
      } else {
        made = [screenOp(sop, panel)];
      }
      ops.push(...made);
      added.push(...made);
    }

    const before = compose(activeOps);
    const after = compose(ops);
    const reshaped = added.some((o) => PROFILE_OPS.has(o.op));
    if (allclose(before, after) && !reshaped) {
      const flat = screenOps.some((s) => s.type === "flatten");
      const message = alreadyUp ? "이미 서 있어요." : flat ? "이미 평평해요." : "바뀌는 것이 없어요. 이미 그 상태예요.";
      return { kind: "noop", ops: [], message, notes: [] };
    }
    const field = profileField(v0, ops);
    if (field) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const x of field) {
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
      if (lo < MIN_FACTOR - 1e-9 || hi > MAX_FACTOR + 1e-9) {
        return {
          kind: "refuse",
          ops: [],
          reason_code: "out_of_range",
          message: `두께는 처음 대비 어디서나 ${MIN_FACTOR}~${MAX_FACTOR}배 사이여야 해요. 지금 요청이면 ${lo.toFixed(2)}~${hi.toFixed(2)}배가 돼요.`,
          notes: [],
        };
      }
    }
    const factors = userFactors(ops);
    if (Math.min(...factors) < MIN_FACTOR - 1e-9 || Math.max(...factors) > MAX_FACTOR + 1e-9) {
      const shown = userFactors(activeOps).map((f) => f.toFixed(2)).join(", ");
      return {
        kind: "refuse",
        ops: [],
        reason_code: "out_of_range",
        message: `크기는 처음 대비 축마다 ${MIN_FACTOR}~${MAX_FACTOR}배까지예요. 지금 배율: ${shown}.`,
        notes: [],
      };
    }
    const base = extents(v0);
    const limit = Math.max(MAX_RATIO, ratio(extentsOf(base, before)));
    if (ratio(extentsOf(base, after)) > limit + 1e-9) {
      return {
        kind: "refuse",
        ops: [],
        reason_code: "out_of_range",
        message: `가장 긴 변이 가장 짧은 변의 ${MAX_RATIO}배를 넘으면 쓸 수 없는 형상이 돼요.`,
        notes: [],
      };
    }
    return { kind: "ops", ops: added, message: "", notes };
  }

  return { panels, labels: basis.labels, linear, compose, apply, resolve, userFactors };
}

// ---------------------------------------------------------------------------
// 버전 (versions.py: append-only, undo·revert도 새 버전)
// ---------------------------------------------------------------------------

/**
 * 브라우저 안에서 버전을 관리한다. 적용은 동기: v0 → 합성 → 검사(target_size 없음) → 충돌체.
 * 검사 오류면 failed로 남기고 활성 버전은 그대로 둔다.
 */
export class EditSession {
  constructor(core, v0, label = "front", { faceBudget = 50000 } = {}) {
    this.core = core;
    this.v0 = v0;
    this.label = label;
    this.faceBudget = faceBudget;
    this.versions = [];
    this.active = 0;
    const e0 = this.#append("base", [{ op: "label", label }], null, { label });
    if (e0.status !== "ready") throw new Error(`e0을 만들지 못했습니다: ${e0.error}`);
    this.active = 0;
  }

  get activeVersion() {
    return this.versions[this.active];
  }

  get canUndo() {
    return this.activeVersion.prev_state != null;
  }

  #append(kind, ops, prev, intent) {
    const v = { version: this.versions.length, kind, ops, prev_state: prev, intent, status: "ready", error: null };
    const mesh = this.core.apply(this.v0, ops);
    const report = inspectMesh(mesh, { face_budget: this.faceBudget, target_size: null });
    v.qc = { errors: [...report.errors].sort(), warnings: [...report.warnings].sort(), extents: report.extents };
    if (report.errors.length) {
      v.status = "failed";
      v.error = `검사 오류: ${v.qc.errors.join(", ")}`;
    } else {
      v.mesh = mesh;
      v.bounds = meshBounds(mesh);
      v.collider = buildCollider(mesh);
      this.active = v.version;
    }
    this.versions.push(v);
    return v;
  }

  /** 화면 op를 풀어 새 편집 버전을 만든다. 반환: resolve 결과 + 만든 버전(있으면) */
  edit(screenOps, panel, intent = {}) {
    const res = this.core.resolve(screenOps, panel, this.activeVersion.ops, this.v0);
    if (res.kind !== "ops") return { ...res, version: null };
    const active = this.activeVersion;
    const v = this.#append("edit", [...active.ops, ...res.ops], active.version, { panel, ...intent, notes: res.notes });
    return { ...res, version: v };
  }

  undo() {
    const active = this.activeVersion;
    if (active.prev_state == null) throw new Error("더 되돌릴 편집이 없어요.");
    const target = this.versions[active.prev_state];
    return this.#append("undo", [...target.ops], target.prev_state, { undo_of: active.version, to: target.version });
  }

  revert(to) {
    const target = this.versions[to];
    if (!target) throw new Error(`e${to} 버전이 없어요.`);
    if (target.status !== "ready") throw new Error(`e${to}은 사용할 수 있는 버전이 아니에요.`);
    return this.#append("revert", [...target.ops], this.active, { revert_to: to });
  }
}

/** 패널에 보이는 정사각 범위 한 변: e0 최대 extent ×1.5, 활성 버전이 넘치면 ×1.1 (버전과 무관하게 고정) */
export function viewSpan(e0Bounds, bounds) {
  const max = ([lo, hi]) => Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  return Math.max(max(e0Bounds) * 1.5, max(bounds) * 1.1, 1e-3);
}
