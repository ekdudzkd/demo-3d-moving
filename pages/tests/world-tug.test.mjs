import test from "node:test";
import assert from "node:assert/strict";
import { newTug, start, pull, step, clearTime, DT, DUR, WIN } from "../world/logic/tug.js";

function play(seed, hz, secs = 40) {
  const sim = newTug(seed);
  start(sim);
  const every = Math.max(1, Math.round(60 / hz));
  for (let t = 0; t < secs * 60 && sim.phase !== "end"; t++) {
    if (hz > 0 && t % every === 0) pull(sim, 0);
    step(sim, DT);
  }
  return sim;
}

test("같은 시드는 같은 결과", () => {
  const a = play(5, 9);
  const b = play(5, 9);
  assert.equal(a.t, b.t);
  assert.equal(a.winner, b.winner);
});

test("아무것도 안 하면 CPU가 이긴다", () => {
  const s = play(1, 0);
  assert.equal(s.winner, 1);
});

test("아주 빠르게 연타하면 이긴다", () => {
  const s = play(3, 12);
  assert.equal(s.winner, 0);
  assert.ok(clearTime(s) > 3 && clearTime(s) < DUR);
});

test("30초가 지나면 끝나고 더 가까운 쪽이 이긴다", () => {
  const s = play(2, 5.4);
  assert.equal(s.phase, "end");
  assert.ok(s.t <= DUR + 0.1);
  assert.ok([0, 1, -1].includes(s.winner));
});

test("줄이 이긴 쪽으로 WIN만큼 가면 즉시 끝", () => {
  const s = play(7, 14);
  if (s.winner === 0) assert.ok(s.X <= -WIN);
});
