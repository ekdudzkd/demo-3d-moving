// 50m 수영 규칙. 화면과 무관한 순수 계산.
import { clamp, mulberry32 } from "./rng.js";

export const LEN = 50;
export const DT = 1 / 60;
export const NAMES = [
  { name: "삐죽이", color: "#6f8fe8", rate: 3.0, br: 0.32, brT: 1.5 },
  { name: "동글이", color: "#f09a8e", rate: 2.7, br: 0.45, brT: 1.3 },
  { name: "꼬물이", color: "#74c496", rate: 3.3, br: 0.24, brT: 1.8 },
];

function swimmer(lane, def, me) {
  return { lane, me, name: me ? "나" : def.name, color: me ? "#ffffff" : def.color, rate: def?.rate, br: def?.br, brT: def?.brT, x: 0, v: 0, o2: 1, breath: 0, breaths: 0, lastStroke: -9, strokes: [], finish: null, next: 0, resting: false, restUntil: 0, phT: 0 };
}

export function newSwim(seed = 1) {
  const rng = mulberry32(seed);
  const s = { t: 0, phase: "ready", lastKey: null, rng, swimmers: [swimmer(0, null, true), ...NAMES.map((d, i) => swimmer(i + 1, d, false))], events: [] };
  return s;
}

export function start(sim) {
  sim.phase = "race";
  sim.t = 0;
  for (const s of sim.swimmers) {
    s.v = 1.9;
    s.lastStroke = 0;
    s.next = 0.3 + sim.rng() * 0.3;
  }
}

export function stroke(sim, s) {
  if (sim.phase !== "race" || s.finish !== null) return false;
  s.strokes.push(sim.t);
  s.lastStroke = sim.t;
  const eff = s.o2 > 0.3 ? 1 : 0.35 + (0.65 * s.o2) / 0.3;
  s.v += 0.34 * eff * clamp(1.35 - s.v / 2.6, 0.15, 1);
  s.o2 = Math.max(0, s.o2 - 0.028);
  s.phT += Math.PI;
  return true;
}

/** 내 키 입력: 같은 쪽을 연달아 누르면 무시(번갈아야 한다) */
export function pressKey(sim, side) {
  if (sim.phase !== "race") return "ignored";
  if (side === sim.lastKey) return "same";
  sim.lastKey = side;
  return stroke(sim, sim.swimmers[0]) ? "ok" : "ignored";
}

export const strokeRate = (sim, s) => s.strokes.filter((t) => sim.t - t < 2).length / 2;

export function step(sim, dt = DT) {
  if (sim.phase !== "race") return;
  sim.t += dt;
  for (const s of sim.swimmers) {
    if (s.finish !== null) {
      s.breath = Math.min(1, s.breath + dt * 2);
      continue;
    }
    if (!s.me) {
      const sprint = s.x > LEN - 7 && s.o2 > 0.05;
      if (s.resting) {
        if (sim.t > s.restUntil) s.resting = false;
      } else if (!sprint && s.o2 < s.br) {
        s.resting = true;
        s.restUntil = sim.t + s.brT;
      } else if (sim.t >= s.next) {
        stroke(sim, s);
        s.next = sim.t + (1 / s.rate) * (0.85 + sim.rng() * 0.3);
      }
    }
    s.v -= s.v * 0.62 * dt;
    if (sim.t - s.lastStroke > 0.45) {
      if (s.breath === 0) s.breaths++;
      s.breath = Math.min(1, s.breath + dt * 3);
      s.o2 = Math.min(1, s.o2 + 0.42 * dt);
    } else s.breath = Math.max(0, s.breath - dt * 4);
    s.x += s.v * dt;
    if (s.x >= LEN) {
      s.x = LEN;
      s.finish = sim.t;
      s.v = 0;
      sim.events.push({ type: "finish", s });
    }
  }
}

export const rankings = (sim) => sim.swimmers.slice().sort((a, b) => (a.finish ?? 1e9) - (b.finish ?? 1e9) || b.x - a.x);
export const done = (sim) => sim.phase === "race" && (sim.swimmers.every((s) => s.finish !== null) || (sim.swimmers[0].finish !== null && sim.t > sim.swimmers[0].finish + 5) || sim.t > 150);
