import test from "node:test";
import assert from "node:assert/strict";
import { newAttempt, pressStep, pressJump, tick, landingDone, decide, nextBarHeight, BAR_X, BEST_WINDOW } from "../world/logic/hj.js";

// hz: 걸음 속도, jumpAt: 바까지 남은 거리가 이 값 이하가 되면 점프 입력
function attempt(barH, { hz = 6.5, jumpAt = 2.0, noJump = false, once = false } = {}) {
  const a = newAttempt(barH);
  let pressed = false;
  const every = Math.round(60 / hz);
  let i = 0;
  for (let t = 0; t < 60 * 40 && !landingDone(a); t++) {
    if (a.phase !== "flight" && a.phase !== "landing" && t % every === 0) pressStep(a, i++ % 2 ? "R" : "L");
    if (!noJump && !(once && pressed) && a.phase === "approach" && BAR_X - a.r.x <= jumpAt) {
      pressJump(a);
      pressed = true;
    }
    tick(a);
  }
  return a;
}

test("알맞은 속도·타이밍이면 1.30m는 넘는다", () => {
  const a = attempt(1.3);
  assert.equal(decide(a).ok, true, decide(a).why);
});

test("점프하지 않으면 바에 부딪혀 실패", () => {
  const a = attempt(1.3, { noJump: true });
  assert.equal(decide(a).ok, false);
  assert.match(decide(a).why, /점프를 안 해서/);
});

test("너무 일찍(4.5m 밖) 누르면 점프하지 않고 달리다 부딪힌다", () => {
  const a = attempt(1.3, { jumpAt: 12, once: true });
  assert.equal(a.flight, null);
});

test("느린 도움닫기로는 높은 바를 못 넘는다", () => {
  const a = attempt(2.0, { hz: 3.2 });
  assert.equal(decide(a).ok, false);
});

test("빠른 도움닫기는 느린 것보다 더 높이 뜬다", () => {
  const slow = attempt(1.3, { hz: 4 }).flight.peakY;
  const fast = attempt(1.3, { hz: 7 }).flight.peakY;
  assert.ok(fast > slow);
});

test("발구름 위치가 적정에서 멀수록 손해", () => {
  const good = attempt(1.3, { jumpAt: 2.0 }).flight.peakY;
  const bad = attempt(1.3, { jumpAt: 4.4 }).flight.peakY;
  assert.ok(good > bad);
});

test("바 높이는 10cm씩, 2m부터 5cm씩", () => {
  assert.equal(nextBarHeight(1.3), 1.4);
  assert.equal(nextBarHeight(2.0), 2.05);
});

test("최적 발구름 구간", () => assert.deepEqual(BEST_WINDOW, [0.8, 3.2]));
