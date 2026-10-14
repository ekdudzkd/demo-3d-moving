import test from "node:test";
import assert from "node:assert/strict";
import { newRace, simTick, rankings, maxCadence, isValidRun, TICK } from "../world/logic/run.js";

// 균등한 박자로 좌우 번갈아 누르는 플레이어
function play(seed, hz, keysFor, secs = 40) {
  const race = newRace(seed);
  const every = Math.round(60 / hz);
  for (let t = 0; t < secs * 60; t++) {
    const keys = t % every === 0 ? [keysFor(Math.floor(t / every))] : [];
    simTick(race, keys);
  }
  return race;
}
const alt = (i) => (i % 2 ? "R" : "L");

test("같은 시드는 같은 결과", () => {
  const a = play(7, 6, alt);
  const b = play(7, 6, alt);
  assert.deepEqual(a.racers.map((r) => r.finishTime), b.racers.map((r) => r.finishTime));
});

test("일정한 박자로 번갈아 누르면 완주하고 넘어지지 않는다", () => {
  const r = play(3, 6, alt).racers[0];
  assert.equal(r.falls, 0);
  assert.ok(r.finishTime > 12 && r.finishTime < 22, `finish ${r.finishTime}`);
});

test("같은 쪽만 연타하면 넘어진다", () => {
  const r = play(3, 6, () => "L").racers[0];
  assert.ok(r.falls >= 1);
});

test("불규칙한 박자는 균형을 무너뜨린다", () => {
  const race = newRace(1);
  let t = 0;
  let i = 0;
  while (t < 60 * 20) {
    const gap = i % 2 ? 4 : 18; // 들쭉날쭉
    simTick(race, [alt(i++)]);
    for (let k = 1; k < gap; k++) simTick(race, []);
    t += gap;
  }
  assert.ok(race.racers[0].falls >= 1);
});

test("CPU 선수는 모두 완주한다", () => {
  const race = play(11, 6, alt, 60);
  for (const r of race.racers.slice(1)) assert.ok(r.finishTime > 12 && r.finishTime < 25, `${r.name} ${r.finishTime}`);
  assert.equal(rankings(race).length, 4);
});

test("1초 16걸음 초과는 기록 무효", () => {
  const race = newRace(5);
  for (let t = 0; t < 60 * 40; t++) {
    simTick(race, t % 3 === 0 ? [alt(t / 3)] : []); // 20걸음/초
  }
  const P = race.racers[0];
  assert.ok(maxCadence(P.stepTicks) > 16 || P.steps < 20);
  if (P.finishTime !== null) assert.equal(isValidRun(P), false);
});

test("틱 간격은 1/60초", () => assert.equal(TICK, 1 / 60));
