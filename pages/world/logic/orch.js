// 오케스트라 지휘 규칙. 손(마우스) 높이 = 소리 크기, 흔드는 빠르기 = 템포. 악장마다 목표가 있고 얼마나 맞췄는지로 점수를 낸다.
import { clamp } from "./rng.js";

export const SECTIONS = [
  { name: "느리고 작게", mark: "Adagio · p", bpm: 70, vol: 0.25, dur: 10 },
  { name: "빠르고 크게", mark: "Allegro · f", bpm: 130, vol: 0.75, dur: 10 },
  { name: "보통 빠르기 · 보통 크기", mark: "Moderato · mf", bpm: 100, vol: 0.5, dur: 10 },
  { name: "아주 빠르고 아주 크게", mark: "Presto · ff", bpm: 165, vol: 0.95, dur: 10 },
];
export const TOTAL = SECTIONS.reduce((a, x) => a + x.dur, 0);
export const INTRO_SEC = 2.5;
export const sectionEnd = (k) => SECTIONS.slice(0, k + 1).reduce((a, x) => a + x.dur, 0);

export function newConductor() {
  return {
    phase: "ready", // ready | intro | play | end
    t: 0,
    sec: 0,
    height: 0.35,
    vol: 0.35,
    tempo: 80,
    speed: 0,
    speedS: 0,
    keyVol: 0,
    taps: [],
    tapBpm: 0,
    tapT: 0,
    acc: SECTIONS.map(() => ({ s: 0, n: 0, bpm: 0, vol: 0 })),
    events: [],
  };
}

export const begin = (c) => {
  c.phase = "intro";
  c.t = 0;
};

/** 포인터 움직임: y는 0(위)~1(아래), speed는 화면 높이 기준 초당 이동량 */
export function pointer(c, y, speed) {
  c.height = clamp((0.9 - y) / 0.8, 0, 1);
  c.speed = Math.max(c.speed, speed);
}

/** 스페이스 두드리기 박자. nowMs는 밀리초 */
export function tap(c, nowMs) {
  c.taps = c.taps.filter((t) => nowMs - t < 2500);
  c.taps.push(nowMs);
  if (c.taps.length >= 2) {
    c.tapBpm = clamp(60000 / ((c.taps[c.taps.length - 1] - c.taps[0]) / (c.taps.length - 1)), 60, 180);
    c.tapT = nowMs;
  }
}

const scoreOne = (S, tempo, vol) => {
  const s1 = clamp(1 - (Math.abs(tempo - S.bpm) - 12) / 40, 0, 1);
  const s2 = clamp(1 - (Math.abs(vol - S.vol) - 0.1) / 0.3, 0, 1);
  return (s1 + s2) / 2;
};

export function update(c, dt, nowMs = 0) {
  if (c.keyVol) c.height = clamp(c.height + c.keyVol * dt * 0.8, 0, 1);
  // 손 빠르기는 최근 최댓값을 천천히 놓아주며 부드럽게 → 템포. 멈추면 느려진다
  c.speed *= Math.exp(-dt / 0.25);
  c.speedS += (c.speed - c.speedS) * (1 - Math.exp(-dt / 0.5));
  let tgt = 60 + clamp((c.speedS - 0.08) / 1.0, 0, 1) * 120;
  if (c.tapBpm && nowMs - c.tapT < 2500) tgt = c.tapBpm;
  c.tempo += (tgt - c.tempo) * (1 - Math.exp(-dt / 0.7));
  c.vol += (c.height - c.vol) * (1 - Math.exp(-dt / 0.25));
  if (c.phase === "intro") {
    c.t += dt;
    if (c.t > INTRO_SEC) {
      c.phase = "play";
      c.t = 0;
      c.events.push("play");
    }
  } else if (c.phase === "play") {
    c.t += dt;
    let k = 0;
    while (k < SECTIONS.length - 1 && c.t > sectionEnd(k)) k++;
    c.sec = k;
    const a = c.acc[k];
    a.s += scoreOne(SECTIONS[k], c.tempo, c.vol) * dt;
    a.n += dt;
    a.bpm += c.tempo * dt;
    a.vol += c.vol * dt;
    if (c.t >= TOTAL) {
      c.phase = "end";
      c.events.push("end");
    }
  }
}

export function summary(c) {
  const tot = c.acc.reduce((a, x) => a + x.s, 0);
  const dur = c.acc.reduce((a, x) => a + x.n, 0) || 1;
  const score = Math.round((tot / dur) * 100);
  const grade = score >= 85 ? "S" : score >= 70 ? "A" : score >= 50 ? "B" : "C";
  return {
    score,
    grade,
    avgBpm: Math.round(c.acc.reduce((a, x) => a + x.bpm, 0) / dur),
    avgVol: Math.round((c.acc.reduce((a, x) => a + x.vol, 0) / dur) * 100),
    sections: SECTIONS.map((S, i) => {
      const a = c.acc[i];
      const n = a.n || 1;
      return { ...S, bpm: Math.round(a.bpm / n), vol: Math.round((a.vol / n) * 100), score: Math.round((a.s / n) * 100) };
    }),
  };
}
