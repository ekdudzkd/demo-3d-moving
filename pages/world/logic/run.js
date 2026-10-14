// 100m 달리기 규칙 (고정 60틱). 화면과 무관한 순수 계산이라 테스트할 수 있다.
import { clamp, mulberry32 } from "./rng.js";

export const TICK = 1 / 60;
export const K_DRAG = 0.75;
export const VMAX = 11.5;
export const FINISH = 100;
export const FALL_SEC = 1.25;
export const GETUP_SEC = 0.55;
export const MAX_HUMAN_CADENCE = 16; // 1초 최대 걸음 수 (이보다 빠르면 기록 무효)

export const BOTS = [
  { name: "삐죽이", color: "#6f8fe8", cadence: 6.3 },
  { name: "동글이", color: "#f09a8e", cadence: 5.9 },
  { name: "꼬물이", color: "#74c496", cadence: 6.7 },
];

export function makeRacer({ name, lane, isPlayer, color }) {
  return {
    name,
    lane,
    isPlayer,
    color,
    impulse: isPlayer ? 0.82 : 0.85,
    irrPenalty: 0.5,
    irrThresh: 0.5,
    x: 0,
    v: 0,
    phase: 0,
    b: 0, // 균형 무너짐 0~1, 1이 되면 넘어짐
    w: 0, // 출발 직후 몸 풀리는 정도
    state: "run", // run | fall | getup
    lastStepTick: null,
    lastDt: null,
    lastKey: null,
    steps: 0,
    stepTicks: [],
    finishTime: null,
    falls: 0,
    fallT: 0,
    gT: 0,
  };
}

export function newRace(seed, playerName = "나") {
  const rng = mulberry32(seed);
  const race = { seed, tick: 0, racers: [], events: [], onEvent: null };
  race.racers.push(makeRacer({ name: playerName, lane: 0, isPlayer: true, color: "#ffffff" }));
  BOTS.forEach((b, i) => {
    const r = makeRacer({ name: b.name, lane: i + 1, isPlayer: false, color: b.color });
    r.cadence = b.cadence * (0.94 + rng() * 0.12);
    r.rng = mulberry32(seed * 31 + i * 977 + 5);
    r.nextStepTick = 3 + Math.floor(rng() * 10);
    race.racers.push(r);
  });
  return race;
}

/** 한 걸음. 너무 빠른 연타(0.05초 미만)는 무시하고, 박자가 흐트러지거나 같은 쪽을 반복하면 균형이 무너진다 */
export function doStep(r, tick, key) {
  if (r.state !== "run" || r.finishTime !== null) return false;
  const dtS = r.lastStepTick === null ? null : (tick - r.lastStepTick) * TICK;
  if (dtS !== null && dtS < 0.05) return false;
  r.v = Math.min(VMAX, r.v + r.impulse);
  if (dtS !== null && dtS < 0.7 && r.lastDt !== null) {
    const irr = Math.abs(Math.log(dtS / r.lastDt));
    r.b += Math.max(0, irr - r.irrThresh) * r.irrPenalty * (0.5 + r.v / VMAX);
  }
  if ((key === "L" || key === "R") && r.lastKey === key) r.b += 0.3;
  r.lastKey = key;
  r.lastDt = dtS !== null && dtS < 0.7 ? dtS : null;
  r.lastStepTick = tick;
  r.steps++;
  r.stepTicks.push(tick);
  return true;
}

function startFall(r, race) {
  r.state = "fall";
  r.fallT = 0;
  r.v = 0;
  r.falls++;
  race.events.push({ tick: race.tick, type: "fall", lane: r.lane });
  race.onEvent?.("fall", r);
}

export function simRacer(r, race) {
  const t = race.tick;
  if (!r.isPlayer && r.state === "run" && r.finishTime === null && t >= r.nextStepTick) {
    doStep(r, t, null);
    const ramp = Math.min(1, 0.6 + (t / 150) * 0.4);
    let interval = (1 / (r.cadence * ramp)) * (1 + (r.rng() - 0.5) * 0.22);
    if (r.rng() < 0.04) interval *= 0.4;
    r.nextStepTick = t + Math.max(3, Math.round(interval * 60));
  }
  r.w = Math.min(1, r.w + TICK * 2.4);
  if (r.state === "run") {
    r.v *= Math.exp(-(r.finishTime !== null ? 1.4 : K_DRAG) * TICK);
    r.x += r.v * TICK;
    r.phase += ((r.v * TICK) / 2.6) * Math.PI * 2;
    r.b = Math.max(0, r.b - 0.32 * TICK);
    if (r.b >= 1 && r.finishTime === null) startFall(r, race);
  } else if (r.state === "fall") {
    r.fallT += TICK;
    if (r.fallT > FALL_SEC) {
      r.state = "getup";
      r.gT = 0;
    }
  } else if (r.state === "getup") {
    r.gT += TICK;
    if (r.gT >= GETUP_SEC) {
      r.state = "run";
      r.v = 0;
      r.b = 0;
      r.lastDt = null;
      r.lastStepTick = null;
      r.lastKey = null;
      r.w = 1;
    }
  }
  if (r.finishTime === null && r.x >= FINISH) {
    r.finishTime = t * TICK - (r.x - FINISH) / Math.max(r.v, 0.5) + TICK;
    race.onEvent?.("finish", r);
  }
}

/** 한 틱: 플레이어 입력(keys: "L"|"R" 배열)을 먼저 반영하고 모두 한 틱 진행 */
export function simTick(race, keys = []) {
  const P = race.racers[0];
  for (const k of keys) doStep(P, race.tick, k);
  for (const r of race.racers) simRacer(r, race);
  race.tick++;
}

/** 1초 동안 가장 많이 누른 걸음 수 */
export function maxCadence(ticks) {
  let best = 0;
  let j = 0;
  for (let i = 0; i < ticks.length; i++) {
    while (ticks[i] - ticks[j] >= 60) j++;
    best = Math.max(best, i - j + 1);
  }
  return best;
}

export function rankings(race) {
  return race.racers.slice().sort((a, b) => (a.finishTime ?? 1e9) - (b.finishTime ?? 1e9) || b.x - a.x);
}

export const isValidRun = (P) => P.finishTime !== null && maxCadence(P.stepTicks) <= MAX_HUMAN_CADENCE;
export { clamp };
