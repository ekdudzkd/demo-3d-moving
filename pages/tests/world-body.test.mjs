import test from "node:test";
import assert from "node:assert/strict";
import { createBodyMapper, toBody, puppetOf } from "../world/logic/body.js";

// 카메라 원본 좌표(거울 아님)로 사람을 만든다. 사람의 왼쪽은 원본 화면의 오른쪽(x 큼)
function pose({ kneeL = 0.75, kneeR = 0.75, wristL = [0.65, 0.6], wristR = [0.35, 0.6], hipY = 0.6, legs = true } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  const set = (i, x, y, v = 0.9) => (lm[i] = { x, y, visibility: v });
  set(0, 0.5, 0.18);
  set(11, 0.6, 0.3);
  set(12, 0.4, 0.3);
  set(13, 0.64, 0.45);
  set(14, 0.36, 0.45);
  set(15, ...wristL);
  set(16, ...wristR);
  set(23, 0.56, hipY);
  set(24, 0.44, hipY);
  set(25, 0.57, kneeL, legs ? 0.9 : 0.1);
  set(26, 0.43, kneeR, legs ? 0.9 : 0.1);
  set(27, 0.57, 0.92, legs ? 0.9 : 0.1);
  set(28, 0.43, 0.92, legs ? 0.9 : 0.1);
  return lm;
}
const collect = () => {
  const out = [];
  return { out, emit: (n, d) => out.push({ n, ...d }) };
};

test("거울 좌표: 사람의 왼쪽 어깨가 화면 왼쪽", () => {
  const b = toBody(pose());
  assert.ok(b.sL.x < b.sR.x);
  assert.ok(b.legsVis);
});

test("제자리 뛰기: 무릎을 번갈아 들면 L·R step", () => {
  const c = collect();
  const m = createBodyMapper(c.emit);
  m.setMode("run");
  let t = 1000;
  for (let r = 0; r < 6; r++) {
    for (let k = 0; k < 5; k++) m.feed(pose({ kneeL: 0.62, kneeR: 0.75 }), (t += 33));
    for (let k = 0; k < 5; k++) m.feed(pose({ kneeL: 0.75, kneeR: 0.62 }), (t += 33));
  }
  const s = c.out.filter((e) => e.n === "step");
  assert.ok(s.length >= 10, `steps ${s.length}`);
  for (let i = 1; i < s.length; i++) assert.notEqual(s[i].side, s[i - 1].side);
});

test("다리가 안 보이면 팔을 번갈아 흔들어 달린다", () => {
  const c = collect();
  const m = createBodyMapper(c.emit);
  m.setMode("run");
  let t = 1000;
  for (let r = 0; r < 6; r++) {
    for (let k = 0; k < 5; k++) m.feed(pose({ legs: false, wristL: [0.65, 0.4], wristR: [0.35, 0.6] }), (t += 33));
    for (let k = 0; k < 5; k++) m.feed(pose({ legs: false, wristL: [0.65, 0.6], wristR: [0.35, 0.4] }), (t += 33));
  }
  assert.ok(c.out.filter((e) => e.n === "step").length >= 10);
});

test("높이뛰기: 두 팔 번쩍 → jump 한 번", () => {
  const c = collect();
  const m = createBodyMapper(c.emit);
  m.setMode("hj");
  let t = 2000;
  for (let k = 0; k < 10; k++) m.feed(pose(), (t += 33));
  for (let k = 0; k < 10; k++) m.feed(pose({ wristL: [0.62, 0.08], wristR: [0.38, 0.08] }), (t += 33));
  assert.equal(c.out.filter((e) => e.n === "jump").length, 1);
});

test("높이뛰기: 골반이 훅 올라가면 jump", () => {
  const c = collect();
  const m = createBodyMapper(c.emit);
  m.setMode("hj");
  let t = 2000;
  for (let k = 0; k < 20; k++) m.feed(pose(), (t += 33));
  m.feed(pose({ hipY: 0.52, kneeL: 0.67, kneeR: 0.67 }), (t += 33));
  assert.equal(c.out.filter((e) => e.n === "jump").length, 1);
});

test("수영: 팔을 번갈아 머리 위로 → 번갈아 step", () => {
  const c = collect();
  const m = createBodyMapper(c.emit);
  m.setMode("swim");
  let t = 0;
  for (let r = 0; r < 4; r++) {
    m.feed(pose({ wristL: [0.65, 0.05] }), (t += 100));
    m.feed(pose(), (t += 100));
    m.feed(pose({ wristR: [0.35, 0.05] }), (t += 100));
    m.feed(pose(), (t += 100));
  }
  const s = c.out.filter((e) => e.n === "step").map((e) => e.side);
  assert.deepEqual(s, ["L", "R", "L", "R", "L", "R", "L", "R"]);
});

test("줄다리기: 손을 위로 뻗었다 끌어내릴 때마다 step", () => {
  const c = collect();
  const m = createBodyMapper(c.emit);
  m.setMode("tug");
  for (let r = 0; r < 3; r++) {
    m.feed(pose({ wristL: [0.6, 0.1], wristR: [0.4, 0.1] }), r * 200);
    m.feed(pose({ wristL: [0.6, 0.5], wristR: [0.4, 0.5] }), r * 200 + 100);
  }
  assert.equal(c.out.filter((e) => e.n === "step").length, 3);
});

test("양궁: 팔 벌리기 → 당김 → 손 모으기 = 발사", () => {
  const c = collect();
  const m = createBodyMapper(c.emit);
  m.setMode("arch");
  m.feed(pose({ wristL: [0.85, 0.3], wristR: [0.2, 0.32] }), 0);
  m.feed(pose({ wristL: [0.9, 0.28], wristR: [0.1, 0.32] }), 33);
  m.feed(pose({ wristL: [0.55, 0.3], wristR: [0.45, 0.32] }), 66);
  const p = c.out.filter((e) => e.n === "pinch").map((e) => e.phase);
  assert.deepEqual(p, ["start", "move", "end"]);
  assert.ok(c.out[1].pull > 0);
});

test("지휘: 손을 높이 들수록 move y가 작다", () => {
  const c = collect();
  const m = createBodyMapper(c.emit);
  m.setMode("orch");
  m.feed(pose({ wristL: [0.65, 0.1] }), 0);
  m.feed(pose({ wristL: [0.65, 0.55], wristR: [0.35, 0.6] }), 33);
  const [a, b] = c.out.filter((e) => e.n === "move");
  assert.ok(a.y < b.y);
});

test("따라하기 자세: 팔을 옆으로 들면 위팔 방향이 수평에 가깝다", () => {
  const b = toBody(pose({ wristL: [0.85, 0.3] }));
  const p0 = puppetOf(toBody(pose()));
  assert.ok(p0.arms && p0.legs);
  const lm = pose();
  lm[13] = { x: 0.75, y: 0.3, visibility: 0.9 };
  const p = puppetOf(toBody(lm));
  const [dx, dy] = p.arms.uaL;
  assert.ok(Math.abs(dy) < 0.02 && dx < 0, `${dx},${dy}`); // 거울 화면에서 왼팔은 왼쪽으로
  assert.ok(b.armsVis);
  assert.equal(puppetOf(toBody(pose({ legs: false }))).legs, null);
});
