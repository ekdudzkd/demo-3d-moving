// 양궁 규칙. 좌표는 과녁 한가운데가 (0,0), 오른쪽 +x, 위 +y (미터, 원작 규격). 화면과 무관한 순수 계산.
import { clamp, mulberry32 } from "./rng.js";

export const D = 30; // 사거리
export const FACE_R = 0.61; // 과녁 반지름
export const RING = 0.061; // 점수 고리 하나의 폭 (10칸)
export const ARROWS = 6;
export const FULL_DRAW_SEC = 1.1;
export const MIN_POWER = 0.2;
export const CPU = [
  { name: "삐죽이", sd: 0.09 },
  { name: "동글이", sd: 0.14 },
  { name: "꼬물이", sd: 0.2 },
];

export function newSession(seed = 1) {
  return { rng: mulberry32(seed), scores: [], aim: { x: 0, y: 0.15 }, wind: 0, drawing: false, drawT: 0, power: 0, t: 0 };
}

/** 다음 화살: 바람과 처음 조준점을 새로 정한다 */
export function nextArrow(s) {
  s.wind = Math.round((s.rng() - 0.5) * 60) / 10;
  s.aim = { x: (s.rng() - 0.5) * 0.5, y: 0.1 + (s.rng() - 0.5) * 0.4 };
  s.drawing = false;
  s.drawT = 0;
  s.power = 0;
}

export function startDraw(s) {
  if (s.drawing) return;
  s.pull = 0;
  s.drawing = true;
  s.drawT = 0;
  s.power = 0;
}
export function cancelDraw(s) {
  s.drawing = false;
  s.pull = 0;
  s.power = 0;
}
export function nudge(s, dx, dy) {
  s.aim.x = clamp(s.aim.x + dx, -1.2, 1.2);
  s.aim.y = clamp(s.aim.y + dy, -1.2, 1.2);
}
export function drag(s, dx, dy) {
  s.aim.x = clamp(s.aim.x + dx, -1.2, 1.2);
  s.aim.y = clamp(s.aim.y + dy, -1.2, 1.2);
}

/** 시간을 진행한다. 당기는 중이면 힘이 찬다 */
export function tick(s, dt) {
  s.t += dt;
  if (s.drawing) {
    s.drawT += dt;
    s.power = clamp(Math.max(s.drawT / FULL_DRAW_SEC, s.pull || 0), 0, 1);
  }
}

/** 손동작: 몸쪽으로 당기는 정도(0~1)가 시간 기준 힘보다 크면 그 값을 쓴다 */
export function setPull(s, v) {
  s.pull = clamp(v, 0, 1);
}

/** 조준점 흔들림: 덜 당겼을수록, 3.2초 넘게 버틸수록 크게 흔들린다 */
export function reticle(s) {
  const fatigue = s.drawing ? Math.max(0, s.drawT - 3.2) : 0;
  const A = 0.028 + (s.drawing ? (1 - s.power) * 0.05 : 0.04) + fatigue * 0.06;
  return {
    x: s.aim.x + A * (Math.sin(s.t * 1.3) + 0.6 * Math.sin(s.t * 2.7 + 1)),
    y: s.aim.y + A * (Math.cos(s.t * 1.1) + 0.5 * Math.sin(s.t * 3.1 + 2)),
  };
}

/** 놓기. 힘이 너무 약하면 null(쏘지 않음). 끝까지 당겼을 때 조준점에 맞고, 덜 당기면 화살이 느려 더 떨어진다 */
export function release(s) {
  const wasDrawing = s.drawing;
  s.drawing = false;
  if (!wasDrawing) return null;
  const P = s.power;
  s.power = 0;
  if (P < MIN_POWER) return { tooWeak: true };
  const ret = reticle(s);
  const speed = 28 + 44 * P;
  const T = D / speed;
  const dropFull = 0.5 * 9.8 * (D / 72) ** 2;
  const drop = 0.5 * 9.8 * T * T - dropFull;
  const hx = ret.x + s.wind * T * 0.35;
  const hy = ret.y - drop;
  const onBoss = Math.abs(hx) < 0.68 && Math.abs(hy) < 0.68;
  return { power: P, T, sag: 0.5 * 9.8 * T * T, hx, hy, onBoss };
}

export function scoreOf(shot) {
  const r = Math.hypot(shot.hx, shot.hy);
  const v = shot.onBoss && r <= FACE_R ? clamp(10 - Math.floor(r / RING), 1, 10) : 0;
  return { v, X: v === 10 && r < RING / 2, hx: shot.hx, hy: shot.hy };
}

export const total = (scores) => scores.reduce((a, s) => a + s.v, 0);
export const label = (s) => (s.X ? "X" : s.v ? String(s.v) : "M");

/** CPU 선수 6발 (가우시안 흩어짐) */
export function cpuField(rng) {
  const gauss = () => Math.sqrt(-2 * Math.log(rng() + 1e-9)) * Math.cos(2 * Math.PI * rng());
  return CPU.map(({ name, sd }) => {
    let t = 0;
    let x = 0;
    for (let i = 0; i < ARROWS; i++) {
      const r = Math.hypot(gauss() * sd, gauss() * sd);
      t += r <= FACE_R ? 10 - Math.floor(r / RING) : 0;
      if (r < RING / 2) x++;
    }
    return { name, total: t, x };
  });
}
