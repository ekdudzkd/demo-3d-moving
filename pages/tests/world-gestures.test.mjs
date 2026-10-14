import test from "node:test";
import assert from "node:assert/strict";
import { createGestureMapper } from "../world/logic/gestures.js";

// 손 좌표를 만든다. 손목(0)은 아래쪽, 중지 뿌리(9)는 위쪽(손가락이 위를 향함), 크기 0.2
function hand({ cx = 0.5, cy = 0.6, index = 0.2, middle = 0.2, thumb = null, fingers = [1, 1, 1, 1], pinch = false, size = 0.2 } = {}) {
  const lm = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  lm[0] = { x: cx, y: cy + size / 2 };
  lm[9] = { x: cx, y: cy - size / 2 };
  lm[5] = { x: cx - 0.03, y: cy - size / 2 };
  lm[6] = { x: cx - 0.03, y: cy - size / 2 - 0.04 };
  lm[8] = { x: cx - 0.03, y: cy - size / 2 - index };
  lm[10] = { x: cx, y: cy - size / 2 - 0.04 };
  lm[12] = { x: cx, y: cy - size / 2 - middle };
  lm[13] = { x: cx + 0.03, y: cy - size / 2 };
  lm[14] = { x: cx + 0.03, y: cy - size / 2 - 0.04 };
  lm[17] = { x: cx + 0.06, y: cy - size / 2 };
  lm[18] = { x: cx + 0.06, y: cy - size / 2 - 0.04 };
  // 펴짐/접힘: 끝(tip)이 손목에서 먼가 (tip-wrist 거리 > pip-wrist 거리 × 1.1)
  const tips = [[8, 6], [12, 10], [16, 14], [20, 18]];
  tips.forEach(([t, q], i) => {
    const base = lm[q];
    lm[t] = fingers[i] ? { x: base.x, y: base.y - 0.08 } : { x: base.x, y: base.y + 0.07 };
  });
  if (fingers.every((f) => f) && (index !== 0.2 || middle !== 0.2)) {
    lm[8] = { x: cx - 0.03, y: cy - size / 2 - index };
    lm[12] = { x: cx, y: cy - size / 2 - middle };
  }
  if (pinch) {
    lm[4] = { x: cx + 0.2, y: cy };
    lm[8] = { x: cx + 0.2 + 0.01, y: cy };
  } else {
    lm[4] = { x: cx - 0.2, y: cy };
  }
  return lm;
}
const collect = () => {
  const out = [];
  return { out, emit: (name, data) => out.push({ name, ...data }) };
};

test("run: 검지와 중지를 번갈아 내밀면 L·R step", () => {
  const c = collect();
  const m = createGestureMapper(c.emit);
  m.setMode("run");
  let now = 0;
  const seq = [
    { index: 0.3, middle: 0.1 },
    { index: 0.1, middle: 0.3 },
    { index: 0.3, middle: 0.1 },
    { index: 0.1, middle: 0.3 },
  ];
  for (let r = 0; r < 4; r++) {
    for (const f of seq) {
      for (let k = 0; k < 4; k++) m.feed(hand(f), (now += 16));
    }
  }
  const steps = c.out.filter((e) => e.name === "step");
  assert.ok(steps.length >= 8, `steps ${steps.length}`);
  for (let i = 1; i < steps.length; i++) assert.notEqual(steps[i].side, steps[i - 1].side);
});

test("hj: 손을 위로 휙 올리면 jump (한 번만)", () => {
  const c = collect();
  const m = createGestureMapper(c.emit);
  m.setMode("hj");
  let now = 1000; // 앱이 켜진 지 1초 뒤
  for (let i = 0; i < 10; i++) m.feed(hand({ cy: 0.8 }), (now += 16));
  for (let i = 0; i < 8; i++) m.feed(hand({ cy: 0.8 - i * 0.04 }), (now += 16));
  assert.equal(c.out.filter((e) => e.name === "jump").length, 1);
});

test("tug: 편 손에서 주먹을 쥘 때마다 step", () => {
  const c = collect();
  const m = createGestureMapper(c.emit);
  m.setMode("tug");
  let now = 0;
  for (let r = 0; r < 5; r++) {
    for (let k = 0; k < 3; k++) m.feed(hand({ fingers: [1, 1, 1, 1] }), (now += 33));
    for (let k = 0; k < 3; k++) m.feed(hand({ fingers: [0, 0, 0, 0] }), (now += 33));
  }
  assert.equal(c.out.filter((e) => e.name === "step").length, 5);
});

test("arch: 집기 → 이동·당김 → 놓기", () => {
  const c = collect();
  const m = createGestureMapper(c.emit);
  m.setMode("arch");
  let now = 0;
  m.feed(hand({ pinch: false }), (now += 33));
  m.feed(hand({ pinch: true, size: 0.2 }), (now += 33)); // start
  m.feed(hand({ pinch: true, size: 0.2, cx: 0.4 }), (now += 33)); // 손이 왼쪽(원본 좌표 x 감소) → 조준 오른쪽(+)
  m.feed(hand({ pinch: true, size: 0.15, cx: 0.4 }), (now += 33)); // 손이 작아짐 → 당김
  m.feed(hand({ pinch: false }), (now += 33)); // end
  const names = c.out.map((e) => e.name + ":" + (e.phase || ""));
  assert.deepEqual(names.filter((n) => n.startsWith("pinch")).slice(0, 2), ["pinch:start", "pinch:move"]);
  assert.equal(c.out.at(-1).phase, "end");
  const mv = c.out.filter((e) => e.phase === "move");
  assert.ok(mv[0].dx > 0, `dx ${mv[0].dx}`);
  assert.ok(mv.at(-1).pull > 0.2, `pull ${mv.at(-1).pull}`);
});

test("arch: 손이 사라지면 cancel", () => {
  const c = collect();
  const m = createGestureMapper(c.emit);
  m.setMode("arch");
  m.feed(hand({ pinch: true }), 0);
  m.lost();
  assert.equal(c.out.at(-1).phase, "cancel");
});

test("orch: 손이 높을수록 move y가 작다(위쪽)", () => {
  const c = collect();
  const m = createGestureMapper(c.emit);
  m.setMode("orch");
  m.feed(hand({ cy: 0.3 }), 0);
  m.feed(hand({ cy: 0.8 }), 16);
  const [hi, lo] = c.out.filter((e) => e.name === "move");
  assert.ok(hi.y < lo.y);
  assert.ok(hi.y >= 0.1 && lo.y <= 0.9);
});

test("swim: 손으로 원을 그리면 번갈아 step", () => {
  const c = collect();
  const m = createGestureMapper(c.emit);
  m.setMode("swim");
  let now = 0;
  for (let i = 0; i < 160; i++) {
    const a = i / 10;
    m.feed(hand({ cx: 0.5 + 0.12 * Math.cos(a), cy: 0.5 + 0.12 * Math.sin(a) }), (now += 33));
  }
  const steps = c.out.filter((e) => e.name === "step");
  assert.ok(steps.length >= 4, `steps ${steps.length}`);
  for (let i = 1; i < steps.length; i++) assert.notEqual(steps[i].side, steps[i - 1].side);
});

test("swim: 가만히 있으면 젓지 않는다", () => {
  const c = collect();
  const m = createGestureMapper(c.emit);
  m.setMode("swim");
  for (let i = 0; i < 120; i++) m.feed(hand({}), i * 33);
  assert.equal(c.out.length, 0);
});

test("free 모드에서는 아무 이벤트도 내지 않는다", () => {
  const c = collect();
  const m = createGestureMapper(c.emit);
  m.setMode("free");
  for (let i = 0; i < 20; i++) m.feed(hand({ index: i % 2 ? 0.3 : 0.1 }), i * 16);
  assert.equal(c.out.length, 0);
});
