// 효과음: 사용자가 누른 뒤에만 소리가 난다 (브라우저 정책). 소리를 못 내도 게임은 그대로 진행된다.
let ctx = null;
let on = true;

function audio() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      ctx = null;
    }
  }
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

export function setSfx(v) {
  on = v;
}

export function tone(freq, dur = 0.08, type = "sine", gain = 0.08, when = 0) {
  if (!on) return;
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export const sfx = {
  step: () => tone(260 + Math.random() * 40, 0.04, "triangle", 0.05),
  beep: () => tone(660, 0.1, "square", 0.05),
  go: () => tone(990, 0.28, "square", 0.06),
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, "triangle", 0.07, i * 0.11)),
  lose: () => [330, 262].forEach((f, i) => tone(f, 0.2, "sawtooth", 0.05, i * 0.16)),
  splash: () => tone(180, 0.12, "sawtooth", 0.03),
  thud: () => tone(90, 0.12, "sine", 0.1),
  bow: () => tone(120, 0.18, "triangle", 0.06),
  hit: () => tone(220, 0.08, "square", 0.06),
  resume: () => audio(),
};
