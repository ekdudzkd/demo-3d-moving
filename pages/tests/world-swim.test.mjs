import test from "node:test";
import assert from "node:assert/strict";
import { newSwim, start, pressKey, step, rankings, done, DT, LEN } from "../world/logic/swim.js";

function race(seed, hz, { alternate = true, secs = 150 } = {}) {
  const sim = newSwim(seed);
  start(sim);
  const every = Math.round(60 / hz);
  let i = 0;
  for (let t = 0; t < secs * 60 && !done(sim); t++) {
    if (t % every === 0) pressKey(sim, alternate ? (i++ % 2 ? "R" : "L") : "L");
    step(sim, DT);
  }
  return sim;
}

test("같은 시드는 같은 결과", () => {
  const a = race(4, 3);
  const b = race(4, 3);
  assert.deepEqual(a.swimmers.map((s) => s.finish), b.swimmers.map((s) => s.finish));
});

test("번갈아 젓는 플레이어와 CPU 모두 50m를 완주한다", () => {
  const sim = race(2, 3);
  for (const s of sim.swimmers) assert.ok(s.finish > 20 && s.finish < 80, `${s.name} ${s.finish}`);
  assert.equal(rankings(sim).length, 4);
});

test("같은 쪽만 누르면 두 번째부터 무시된다", () => {
  const sim = newSwim(1);
  start(sim);
  assert.equal(pressKey(sim, "L"), "ok");
  assert.equal(pressKey(sim, "L"), "same");
  assert.equal(pressKey(sim, "R"), "ok");
});

test("너무 빠른 연타는 숨이 차서 효율이 떨어진다", () => {
  const sim = newSwim(1);
  start(sim);
  const me = sim.swimmers[0];
  for (let t = 0; t < 60 * 6; t++) {
    if (t % 4 === 0) pressKey(sim, (t / 4) % 2 ? "R" : "L");
    step(sim, DT);
  }
  assert.ok(me.o2 < 0.3);
});

test("멈추면 숨이 회복된다", () => {
  const sim = newSwim(1);
  start(sim);
  const me = sim.swimmers[0];
  me.o2 = 0.2;
  for (let t = 0; t < 120; t++) step(sim, DT);
  assert.ok(me.o2 > 0.6);
});

test("거리는 50m", () => assert.equal(LEN, 50));
