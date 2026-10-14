// 높이뛰기 규칙. 좌표는 도움닫기 시작점이 0, 바는 BAR_X(20m). 화면과 무관한 순수 계산.
import { clamp } from "./rng.js";
import { TICK, makeRacer, doStep, simRacer } from "./run.js";

export const BAR_X = 20;
export const MAT_END = 26;
export const MAT_H = 0.5;
export const HIP0 = 1.0; // 서 있을 때 몸 중심 높이(가상)
export const FOOT = 0.9; // 몸 중심에서 가장 아래까지
export const G = 9.8;
export const START_BAR = 1.3;
export const MAX_FAILS = 3;
export const OK_WINDOW = [0.3, 4.5]; // 바 앞 이 안에서 뛰면 점프 인정
export const BEST_WINDOW = [0.8, 3.2]; // 발구름이 가장 좋은 구간

export const groundAt = (x) => (x > BAR_X + 0.1 && x < MAT_END ? MAT_H : 0);

export function newAttempt(barH) {
  const r = makeRacer({ name: "나", lane: 0, isPlayer: true, color: "#fff" });
  r.irrPenalty *= 0.5; // 높이뛰기는 박자 흔들림 감점을 줄인다
  return {
    barH,
    r,
    fr: { tick: 0, events: [], onEvent: null },
    phase: "wait", // wait | approach | flight | landing
    queue: [],
    jumpReq: null,
    jumpReqTick: 0,
    flight: null,
    hipY: HIP0,
    hipCrossY: null,
    barDown: false,
    reason: null,
    landT: 0,
    tick: 0,
    early: null,
  };
}

export function pressStep(a, side) {
  if (a.phase === "wait") a.phase = "approach";
  if (a.phase === "approach") a.queue.push(side);
}
/** 점프 입력은 0.4초 동안 유효: 조금 일찍 눌러도 바 앞 4.5m 안에 들어서는 순간 뛴다 */
export function pressJump(a, s = 0.5) {
  if (a.phase === "approach" && a.jumpReq === null) {
    a.jumpReq = s;
    a.jumpReqTick = a.tick;
  }
}

export function takeoff(a, d, s) {
  const r = a.r;
  const tol = 1.2;
  const off = Math.abs(d - 2.0);
  const eff = 1 - 0.1 * Math.min(1, off / tol) - 0.12 * clamp((off - tol) / 1.3, 0, 1);
  const peak = 1.05 + 0.13 * r.v + 0.1 * s;
  const rise = Math.max(0.3, peak - HIP0) * eff;
  const vy = Math.sqrt(2 * G * rise);
  const tPeak = vy / G;
  a.flight = { x: r.x, y: HIP0, vx: clamp(d / tPeak, 1.0, 9.5), vy, x0: r.x, d, v: r.v, peakY: HIP0 + rise };
  a.phase = "flight";
  a.onTakeoff?.(a.flight);
}

function land(a) {
  a.phase = "landing";
  a.landT = 0;
  a.slide = a.flight ? a.flight.vx * 0.5 : 2;
  a.onLand?.();
}

function knock(a) {
  if (a.barDown) return;
  a.barDown = true;
  a.onKnock?.();
}

export function tick(a) {
  const r = a.r;
  a.fr.tick = a.tick;
  const x0 = r.x + (a.phase === "flight" ? 0 : 0);
  const hipX0 = a.phase === "flight" ? a.flight.x : r.x;
  if (a.phase === "approach") {
    for (const k of a.queue) doStep(r, a.tick, k);
    a.queue.length = 0;
    simRacer(r, a.fr);
    if (a.jumpReq !== null) {
      const d = BAR_X - r.x;
      if (r.state === "run" && d <= OK_WINDOW[1] && d >= OK_WINDOW[0]) {
        takeoff(a, d, a.jumpReq);
        a.jumpReq = null;
      } else if (a.tick - a.jumpReqTick > 24 || r.state !== "run") {
        if (r.state === "run" && d > OK_WINDOW[1]) a.early = d;
        a.jumpReq = null;
      }
    }
    if (a.phase === "approach") {
      if (r.state === "run" && r.x > BAR_X - 0.3) {
        knock(a);
        a.reason = "점프를 안 해서 바에 부딪혔어요";
        a.flight = null;
        a.slide = Math.max(r.v, 3) * 0.5;
        a.phase = "landing";
        a.landT = 0;
        a.onLand?.();
      } else if (r.state === "fall") {
        a.reason = "달리다 넘어졌어요";
        a.slide = 0;
        a.phase = "landing";
        a.landT = 0;
        a.onLand?.();
      }
    }
  } else if (a.phase === "flight") {
    const F = a.flight;
    F.vy -= G * TICK;
    F.x += F.vx * TICK;
    F.y += F.vy * TICK;
    r.x = F.x;
    a.hipY = F.y;
    if (F.vy < 0 && F.y - FOOT <= groundAt(F.x) + 0.04) land(a);
  } else if (a.phase === "landing") {
    a.landT += TICK;
    a.slide *= Math.exp(-3 * TICK);
    if (a.flight) {
      a.hipY += (HIP0 - 0.55 - a.hipY) * Math.min(1, TICK * 10); // 매트에 주저앉는다
      a.flight.x += a.slide * TICK;
      r.x = a.flight.x;
    } else r.x += a.slide * TICK;
  }
  // 몸 중심이 바를 지나는 순간의 높이
  const hipX1 = a.phase === "flight" || (a.flight && a.phase === "landing") ? a.flight.x : r.x;
  if (a.hipCrossY === null && hipX0 < BAR_X && hipX1 >= BAR_X) {
    a.hipCrossY = a.phase === "flight" ? a.hipY : a.hipY;
    if (a.hipCrossY < a.barH + 0.04) knock(a);
  }
  a.tick++;
}

export function landingDone(a) {
  return a.phase === "landing" && a.landT > 1.3;
}

/** 시기 판정 */
export function decide(a) {
  const ok = !a.barDown && !a.reason && a.hipCrossY !== null && a.hipCrossY >= a.barH + 0.04;
  if (ok) return { ok, why: `${a.barH.toFixed(2)}m 성공!` };
  const F = a.flight;
  let timing = "";
  if (F) {
    if (F.d > 3.2) timing = ` (바 앞 ${F.d.toFixed(1)}m, 너무 일찍 뛰었어요)`;
    else if (F.d < 0.8) timing = ` (바 앞 ${F.d.toFixed(1)}m, 너무 늦게 뛰었어요)`;
    else if (F.peakY < a.barH + 0.1) timing = ` (${(F.v * 3.6).toFixed(0)}km/h로는 ${Math.max(0, F.peakY - 0.1).toFixed(2)}m까지만 넘어요. 더 빨리 달려보세요)`;
  }
  let why = a.reason || (a.hipCrossY === null ? "바에 닿기 전에 내려왔어요" : a.barDown ? "바를 건드렸어요" : "바 아래로 지나갔어요");
  return { ok, why: why + timing };
}

export const nextBarHeight = (h) => Math.round((h + (h >= 1.995 ? 0.05 : 0.1)) * 100) / 100;
export const CPU_BEST = [
  { name: "삐죽이", h: 1.9 },
  { name: "꼬물이", h: 1.7 },
  { name: "동글이", h: 1.5 },
];
