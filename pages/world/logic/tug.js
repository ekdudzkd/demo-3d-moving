// 줄다리기 규칙 (1P 대 CPU). 최근에 당긴 힘(f)이 큰 쪽으로 줄이 움직인다. 화면과 무관한 순수 계산.
import { clamp, mulberry32 } from "./rng.js";

export const WIN = 3.0; // 줄이 이 거리만큼 넘어오면 승리 (월드 규격)
export const DUR = 30;
export const DT = 1 / 60;
const SCALE = WIN / 2.0; // 원작은 ±2.0m. 월드는 ±3.0m라서 속도를 같은 비율로 키운다

export function newTug(seed = 1) {
  const rng = mulberry32(seed);
  return {
    phase: "ready", // ready | pull | end
    rng,
    t: 0,
    X: 0, // 음수 = 내 쪽으로 끌려옴(승리 방향)
    v: 0,
    teams: [
      { f: 0, jerk: 0, pulls: 0 },
      { f: 0, jerk: 0, pulls: 0 },
    ],
    cpuNext: 0,
    cpuSurge: 0,
    winner: null, // 0 = 나, 1 = CPU, -1 = 무승부
  };
}

export function start(sim) {
  sim.phase = "pull";
  sim.t = 0;
}

export function pull(sim, k) {
  if (sim.phase !== "pull") return false;
  const T = sim.teams[k];
  T.f += 1;
  T.jerk = 1;
  T.pulls++;
  return true;
}

export function step(sim, dt = DT) {
  if (sim.phase === "pull") {
    sim.t += dt;
    // CPU: 기본 박자 + 가끔 힘을 몰아 쓰고, 끝으로 갈수록 조금 지친다
    const base = 5.4;
    if (sim.t > sim.cpuSurge + 5 + sim.rng() * 3 && sim.rng() < dt) sim.cpuSurge = sim.t;
    const rate = base + 0.7 * Math.sin(sim.t * 0.9) + (sim.t - sim.cpuSurge < 1.5 ? 1.6 : 0) - (sim.t > 20 ? 0.5 : 0);
    if (sim.t >= sim.cpuNext) {
      pull(sim, 1);
      sim.cpuNext = sim.t + (1 / rate) * (0.8 + sim.rng() * 0.4);
    }
    for (const T of sim.teams) T.f *= Math.exp(-dt / 0.7);
    sim.v += ((sim.teams[1].f - sim.teams[0].f) * 0.18 * SCALE - sim.v) * (1 - Math.exp(-dt / 0.35));
    sim.X += sim.v * dt;
    if (sim.X <= -WIN) end(sim, 0);
    else if (sim.X >= WIN) end(sim, 1);
    else if (sim.t >= DUR) end(sim, Math.abs(sim.X) < 0.15 * SCALE ? -1 : sim.X < 0 ? 0 : 1);
  } else if (sim.phase === "end") {
    sim.v *= Math.exp(-dt * 3);
    sim.X += sim.v * dt;
  }
  for (const T of sim.teams) T.jerk = Math.max(0, T.jerk - dt * 4);
}

function end(sim, w) {
  sim.phase = "end";
  sim.winner = w;
}

/** 완승(줄을 끝까지 끌어옴)이면 걸린 시간, 아니면 null */
export const clearTime = (sim) => (sim.winner === 0 && Math.abs(sim.X) >= WIN - 1e-6 ? sim.t : null);
export { clamp };
