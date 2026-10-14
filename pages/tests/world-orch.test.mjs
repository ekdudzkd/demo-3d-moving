import test from "node:test";
import assert from "node:assert/strict";
import { newConductor, begin, update, pointer, tap, summary, SECTIONS, TOTAL, INTRO_SEC } from "../world/logic/orch.js";

// 악장마다 목표(bpm·크기)를 정확히 따라가는 지휘자
function conduct(follow) {
  const c = newConductor();
  begin(c);
  let now = 0;
  while (c.phase !== "end") {
    const S = SECTIONS[c.sec];
    if (follow && c.phase === "play") {
      c.height = S.vol;
      c.tapBpm = S.bpm;
      c.tapT = now;
    } else if (!follow) {
      c.height = 0.05;
      c.tapBpm = 175;
      c.tapT = now;
    }
    update(c, 1 / 60, now);
    now += 1000 / 60;
  }
  return c;
}

test("악장은 4개, 총 40초", () => {
  assert.equal(SECTIONS.length, 4);
  assert.equal(TOTAL, 40);
});

test("처음 2.5초는 도입부, 그 뒤 연주 시작", () => {
  const c = newConductor();
  begin(c);
  for (let i = 0; i < 60 * INTRO_SEC + 5; i++) update(c, 1 / 60, i * 16.7);
  assert.equal(c.phase, "play");
});

test("악보를 따라가면 높은 점수 (S)", () => {
  const r = summary(conduct(true));
  assert.ok(r.score >= 85, `score ${r.score}`);
  assert.equal(r.grade, "S");
});

test("악보와 반대로 지휘하면 낮은 점수", () => {
  const r = summary(conduct(false));
  assert.ok(r.score < 50, `score ${r.score}`);
});

test("손을 빨리 흔들수록 템포가 올라간다", () => {
  const slow = newConductor();
  const fast = newConductor();
  for (let i = 0; i < 180; i++) {
    pointer(slow, 0.5, 0.05);
    pointer(fast, 0.5, 1.4);
    update(slow, 1 / 60, i * 16.7);
    update(fast, 1 / 60, i * 16.7);
  }
  assert.ok(fast.tempo > slow.tempo + 40);
});

test("스페이스 두드리기는 BPM으로 바뀐다", () => {
  const c = newConductor();
  tap(c, 0);
  tap(c, 500);
  tap(c, 1000);
  assert.ok(Math.abs(c.tapBpm - 120) < 1);
});

test("손이 높을수록 소리가 커진다", () => {
  const c = newConductor();
  pointer(c, 0.1, 0);
  for (let i = 0; i < 120; i++) update(c, 1 / 60, i * 16.7);
  assert.ok(c.vol > 0.9);
});
