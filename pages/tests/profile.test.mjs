// 5-7 두께 단면 편집 (D-029): 지우개처럼 고르게 밀어낸 판을 말로 둥글게·한쪽 얇게 만든다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createEditCore } from "../edit.js";
import { planEdit } from "../planner.js";

const basis = JSON.parse(readFileSync(new URL("../../backend/app/edit/basis.json", import.meta.url), "utf-8"));
const core = createEditCore(basis);
const FRONT = [{ op: "label", label: "front" }];

/** 앞·뒤 면이 격자(안쪽 정점 있음)인 두께 0.2 판. 앞면 i와 뒷면 i+N은 같은 (x, y) */
function slab(n = 9) {
  const v = [];
  const f = [];
  const N = n * n;
  for (const z of [0.1, -0.1]) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v.push(i / (n - 1) - 0.5, j / (n - 1) - 0.5, z);
  const id = (i, j, back) => j * n + i + (back ? N : 0);
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      f.push(id(i, j, 0), id(i + 1, j, 0), id(i + 1, j + 1, 0), id(i, j, 0), id(i + 1, j + 1, 0), id(i, j + 1, 0));
      f.push(id(i, j, 1), id(i + 1, j + 1, 1), id(i + 1, j, 1), id(i, j, 1), id(i, j + 1, 1), id(i + 1, j + 1, 1));
    }
  }
  const ring = [];
  for (let i = 0; i < n - 1; i++) ring.push([i, 0]);
  for (let j = 0; j < n - 1; j++) ring.push([n - 1, j]);
  for (let i = n - 1; i > 0; i--) ring.push([i, n - 1]);
  for (let j = n - 1; j > 0; j--) ring.push([0, j]);
  ring.forEach(([i, j], k) => {
    const [i2, j2] = ring[(k + 1) % ring.length];
    f.push(id(i, j, 0), id(i, j, 1), id(i2, j2, 1), id(i, j, 0), id(i2, j2, 1), id(i2, j2, 0));
  });
  return { mesh: { v: Float64Array.from(v), f: Uint32Array.from(f), c: new Float32Array(v.length) }, N, n };
}

const { mesh: v0, N, n } = slab();
const center = Math.floor(n / 2) * n + Math.floor(n / 2);
const corner = 0;
/** 정점 i 위치의 두께 = 앞면 i와 뒷면 i+N 사이 거리 (월드 좌표) */
const thick = (m, i) => Math.hypot(...[0, 1, 2].map((k) => m.v[i * 3 + k] - m.v[(i + N) * 3 + k]));
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);
const plan = (text) => planEdit(text).ops;
const edit = (text, panel, active = FRONT) => core.resolve(plan(text), panel, active, v0);

test("문장 → 두께 단면 op", () => {
  assert.deepEqual(plan("가장자리 둥글게"), [{ type: "round", mode: "edge", amount: 0.6 }]);
  assert.deepEqual(plan("가장자리를 얇게"), [{ type: "round", mode: "edge", amount: 0.6 }]);
  assert.deepEqual(plan("많이 볼록하게"), [{ type: "round", mode: "bulge", amount: 0.8 }]);
  assert.deepEqual(plan("위로 갈수록 얇게"), [{ type: "taper", axis: "screen_up", ratio: 0.5 }]);
  assert.deepEqual(plan("아래는 두껍게"), [{ type: "taper", axis: "screen_up", ratio: 0.5 }]);
  assert.deepEqual(plan("윗부분을 두껍게"), [{ type: "taper", axis: "screen_up", ratio: 2 }]);
  assert.deepEqual(plan("오른쪽을 3배 두껍게"), [{ type: "taper", axis: "screen_right", ratio: 3 }]);
  assert.deepEqual(plan("평평하게"), [{ type: "flatten" }]);
  // 기존 전체 변환 문장은 그대로
  assert.deepEqual(plan("더 두껍게"), [{ type: "scale_axis", axis: "toward_viewer", factor: 1.25 }]);
  assert.equal(planEdit("위로 20배 얇게").kind, "refuse");
});

test("가장자리 둥글게: 가운데 두께는 그대로, 가장자리는 얇아진다", () => {
  const r = edit("가장자리 둥글게", "right");
  assert.equal(r.kind, "ops");
  const out = core.apply(v0, [...FRONT, ...r.ops]);
  close(thick(out, center), 0.2, 1e-6);
  assert.ok(thick(out, corner) < 0.2 * 0.45, `corner ${thick(out, corner)}`);
});

test("볼록하게: 가운데가 두꺼워지고 가장자리는 그대로", () => {
  const out = core.apply(v0, [...FRONT, ...edit("볼록하게", "right").ops]);
  close(thick(out, center), 0.2 * 1.6, 1e-6);
  assert.ok(thick(out, corner) < 0.2 * 1.1);
});

test("옆 패널 '위로 갈수록 얇게': 맨 위 두께가 맨 아래의 절반", () => {
  const out = core.apply(v0, [...FRONT, ...edit("위로 갈수록 얇게", "right").ops]);
  const bottom = Math.floor(n / 2); // j = 0 줄
  const top = (n - 1) * n + Math.floor(n / 2);
  close(thick(out, top) / thick(out, bottom), 0.5);
});

test("물체를 돌린 뒤에도 패널의 '위'를 기준으로 얇아진다", () => {
  const active = [...FRONT, { op: "rotate", axis: "z", k: 1 }];
  const r = edit("위로 갈수록 얇게", "right", active);
  assert.deepEqual(r.ops, [{ op: "taper", axis: "x", ratio: 0.5 }]); // 월드 위 = 회전 전 물체 +x
  const out = core.apply(v0, [...active, ...r.ops]);
  const ys = [...Array(N).keys()].map((i) => out.v[i * 3 + 1]);
  const hiY = ys.indexOf(Math.max(...ys));
  const loY = ys.indexOf(Math.min(...ys));
  close(thick(out, hiY) / thick(out, loY), 0.5);
});

test("두께 방향과 같은 화면 축이면 거절 (위 패널의 '위' = 두께 축)", () => {
  const r = edit("위로 갈수록 얇게", "top");
  assert.equal(r.kind, "refuse");
  assert.equal(r.reason_code, "out_of_scope");
});

test("반대로·평평하게는 정확히 원래 판으로 돌아간다", () => {
  const base = core.apply(v0, FRONT);
  const r1 = edit("가장자리 둥글게", "front").ops;
  const r2 = core.resolve(plan("반대로"), "front", [...FRONT, ...r1], v0).ops;
  const back = core.apply(v0, [...FRONT, ...r1, ...r2]);
  base.v.forEach((x, i) => close(back.v[i], x, 1e-9));

  const shaped = [...FRONT, ...r1, ...edit("볼록하게", "front").ops, ...edit("위로 갈수록 얇게", "right").ops];
  const flat = core.resolve(plan("평평하게"), "front", shaped, v0);
  assert.equal(flat.kind, "ops");
  const after = core.apply(v0, [...shaped, ...flat.ops]);
  // 둥글게 성분만 상쇄되고 위아래 두께 차이(taper)는 남는다
  const tapered = core.apply(v0, [...FRONT, ...edit("위로 갈수록 얇게", "right").ops]);
  tapered.v.forEach((x, i) => close(after.v[i], x, 1e-9));
});

test("둥글게 한 적 없으면 '평평하게'는 noop", () => {
  const r = edit("평평하게", "front");
  assert.equal(r.kind, "noop");
  assert.equal(r.message, "이미 평평해요.");
});

test("두께가 0.1배 아래로 내려가면 거절", () => {
  let active = FRONT;
  for (let i = 0; i < 2; i++) active = [...active, ...edit("가장자리 둥글게", "front", active).ops];
  const r = edit("가장자리 둥글게", "front", active); // 0.4³ = 0.064
  assert.equal(r.kind, "refuse");
  assert.equal(r.reason_code, "out_of_range");
});
