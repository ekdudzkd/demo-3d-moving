import test from "node:test";
import assert from "node:assert/strict";
import { newSession, nextArrow, startDraw, tick, release, scoreOf, reticle, total, cpuField, D, FULL_DRAW_SEC, MIN_POWER, ARROWS } from "../world/logic/arch.js";

function shootAt(s, hold = FULL_DRAW_SEC, aim = { x: 0, y: 0.15 }) {
  s.aim = { ...aim };
  startDraw(s);
  for (let t = 0; t < hold * 60; t++) tick(s, 1 / 60);
  return release(s);
}

test("너무 짧게 당기면 쏘지 않는다", () => {
  const s = newSession(1);
  nextArrow(s);
  const r = shootAt(s, MIN_POWER * FULL_DRAW_SEC * 0.5);
  assert.equal(r.tooWeak, true);
});

test("끝까지 당기고 바람이 없으면 조준점 근처에 맞는다", () => {
  const s = newSession(2);
  nextArrow(s);
  s.wind = 0;
  const r = shootAt(s, FULL_DRAW_SEC, { x: 0, y: 0 });
  assert.ok(Math.hypot(r.hx, r.hy) < 0.25, JSON.stringify(r));
  assert.ok(scoreOf(r).v >= 5);
});

test("덜 당기면 화살이 더 떨어진다", () => {
  const s = newSession(3);
  s.wind = 0;
  const half = shootAt(s, FULL_DRAW_SEC * 0.5, { x: 0, y: 0 });
  const s2 = newSession(3);
  s2.wind = 0;
  const full = shootAt(s2, FULL_DRAW_SEC, { x: 0, y: 0 });
  assert.ok(half.hy < full.hy);
});

test("바람은 화살을 옆으로 민다", () => {
  const a = newSession(4);
  a.wind = 4;
  const b = newSession(4);
  b.wind = -4;
  const ra = shootAt(a, FULL_DRAW_SEC, { x: 0, y: 0 });
  const rb = shootAt(b, FULL_DRAW_SEC, { x: 0, y: 0 });
  assert.ok(ra.hx > rb.hx);
});

test("점수: 정중앙 X 10점, 한참 벗어나면 0점", () => {
  assert.deepEqual(scoreOf({ hx: 0, hy: 0.01, onBoss: true }).X, true);
  assert.equal(scoreOf({ hx: 0, hy: 0.0, onBoss: true }).v, 10);
  assert.equal(scoreOf({ hx: 0.3, hy: 0, onBoss: true }).v, 10 - Math.floor(0.3 / 0.061));
  assert.equal(scoreOf({ hx: 0.9, hy: 0, onBoss: false }).v, 0);
});

test("오래 버틸수록 조준점이 심하게 흔들린다", () => {
  const s = newSession(5);
  s.aim = { x: 0, y: 0 };
  startDraw(s);
  const spread = (sec) => {
    s.drawT = sec;
    s.power = 1;
    let m = 0;
    for (let t = 0; t < 200; t++) {
      s.t = t * 0.05;
      const r = reticle(s);
      m = Math.max(m, Math.hypot(r.x, r.y));
    }
    return m;
  };
  assert.ok(spread(6) > spread(1));
});

test("CPU 선수는 6발, 점수는 0~60", () => {
  const f = cpuField(newSession(9).rng);
  assert.equal(f.length, 3);
  for (const c of f) assert.ok(c.total >= 0 && c.total <= 10 * ARROWS);
  assert.equal(D, 30);
});

test("손동작 당김(pull)이 시간 기준 힘보다 크면 그 값을 쓴다", async () => {
  const { setPull } = await import("../world/logic/arch.js");
  const s = newSession(8);
  startDraw(s);
  setPull(s, 0.8);
  tick(s, 0.1);
  assert.ok(s.power >= 0.8);
  const shot = release(s);
  assert.ok(shot.power >= 0.8);
  startDraw(s);
  assert.equal(s.pull, 0); // 새로 잡으면 당김 초기화
});
