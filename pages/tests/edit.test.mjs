// 5-5 교차 언어 테스트: Python(backend/tests/unit/test_edit_shared_cases.py·test_edit_planner.py)과
// 같은 backend/tests/fixtures/edit_cases.json으로 JS 편집 코어·Mock 플래너를 검사한다.
// 실행: node --test pages/tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { EditSession, HEADING_PANELS, createEditCore, extents, headingHalfExtents, headingRotation, meshBounds } from "../edit.js";
import { planEdit } from "../planner.js";

const root = new URL("../../", import.meta.url);
const basis = JSON.parse(readFileSync(new URL("backend/app/edit/basis.json", root), "utf-8"));
const shared = JSON.parse(readFileSync(new URL("backend/tests/fixtures/edit_cases.json", root), "utf-8"));
const core = createEditCore(basis);

const mesh = (name) => {
  const m = shared.meshes[name];
  return { v: Float64Array.from(m.v.flat()), f: Uint32Array.from(m.f.flat()), c: new Float32Array(m.v.length * 3) };
};
const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

for (const [label, matrix] of Object.entries(shared.label_matrices)) {
  test(`라벨 회전 행렬: ${label}`, () => {
    assert.deepEqual(core.compose([{ op: "label", label }]).map((r) => r.map((x) => x + 0)), matrix);
  });
}

for (const c of shared.resolve) {
  test(`resolve: ${c.name}`, () => {
    const v0 = mesh(c.mesh);
    const res = core.resolve(c.screen_ops, c.panel, c.active_ops, v0);
    assert.equal(res.kind, c.kind);
    assert.equal(res.message, c.message);
    if (c.kind === "ops") {
      assert.equal(res.ops.length, c.ops.length);
      res.ops.forEach((op, i) => {
        const want = c.ops[i];
        assert.equal(op.op, want.op);
        if (want.factors) want.factors.forEach((f, k) => close(op.factors[k], f, 1e-12));
        else assert.deepEqual(op, want);
      });
      assert.equal(res.notes.length, c.notes);
      const out = core.apply(v0, [...c.active_ops, ...res.ops]);
      extents(out).forEach((e, k) => close(e, c.extents[k]));
      close(meshBounds(out)[0][1], 0, 1e-9);
    }
    if (c.kind === "refuse") assert.equal(res.reason_code, c.reason_code);
  });
}

for (const c of shared.planner) {
  test(`planner: "${c.text}" (${c.panel})`, () => {
    const r = planEdit(c.text);
    assert.equal(r.kind, c.kind, JSON.stringify(r));
    if (c.kind === "ops") {
      assert.equal(r.ops.length, c.ops.length);
      r.ops.forEach((op, i) => {
        const want = c.ops[i];
        assert.deepEqual(Object.keys(op).sort(), Object.keys(want).sort());
        for (const [k, v] of Object.entries(want)) {
          if (k === "factor") close(op.factor, v, 1e-9);
          else assert.equal(op[k], v);
        }
      });
    } else {
      assert.ok(r.message);
      if (c.kind === "refuse") assert.equal(r.reason_code, c.reason_code);
    }
  });
}

test("부분 편집 거절의 제안 문장은 전체 편집으로 다시 해석된다", () => {
  const r = planEdit("귀만 길게");
  assert.equal(r.reason_code, "part_edit");
  assert.equal(planEdit(r.suggested_text).kind, "ops");
});

test("버전: 세워줘 → 두껍게 → undo → undo = e0 op, 이력은 append-only", () => {
  const s = new EditSession(core, mesh("lying_box"), "front");
  const e1 = s.edit(planEdit("세워줘").ops, "front").version;
  const e2 = s.edit(planEdit("더 두껍게").ops, "front").version;
  assert.equal(s.active, e2.version);
  close(extents(e2.mesh)[2], extents(e1.mesh)[2] * 1.25);
  s.undo();
  assert.deepEqual(s.activeVersion.ops, e1.ops);
  const back = s.undo();
  assert.deepEqual(back.ops, s.versions[0].ops);
  assert.equal(back.kind, "undo");
  assert.equal(s.canUndo, false);
  assert.throws(() => s.undo());
  assert.equal(s.versions.length, 5);
});

test("버전: revert는 새 버전을 추가하고 다시 undo할 수 있다", () => {
  const s = new EditSession(core, mesh("lying_box"), "left");
  s.edit([{ type: "scale_uniform", factor: 2 }], "left");
  const r = s.revert(0);
  assert.equal(r.kind, "revert");
  assert.deepEqual(r.ops, [{ op: "label", label: "left" }]);
  s.undo();
  assert.deepEqual(s.activeVersion.ops, s.versions[1].ops);
});

test("버전: noop·refuse는 버전을 만들지 않는다", () => {
  const s = new EditSession(core, mesh("standing_box"), "front");
  assert.equal(s.edit([{ type: "stand_up" }], "front").kind, "noop");
  assert.equal(s.edit([{ type: "invert_last" }], "front").kind, "refuse");
  assert.equal(s.versions.length, 1);
});

// three.js rotation.y = θ: (x, z) → (x cosθ + z sinθ, −x sinθ + z cosθ)
const rotY = ([x, , z], t) => [x * Math.cos(t) + z * Math.sin(t), -x * Math.sin(t) + z * Math.cos(t)];

for (const heading of HEADING_PANELS) {
  test(`앞쪽 ${heading}: 그 패널 쪽 면이 진행 방향(로컬 +X)을 본다`, () => {
    const t = headingRotation(basis.panels, heading);
    const [x, z] = rotY(basis.panels[heading].toward_viewer, t);
    close(x, 1, 1e-12);
    close(z, 0, 1e-12);
  });
}

test("앞쪽이 옆면이면 충돌 상자 x·z 반치수가 바뀐다", () => {
  const half = [0.5, 1, 0.1];
  assert.deepEqual(headingHalfExtents(half, headingRotation(basis.panels, "front")), [0.1, 0.5]);
  assert.deepEqual(headingHalfExtents(half, headingRotation(basis.panels, "right")), [0.5, 0.1]);
});
