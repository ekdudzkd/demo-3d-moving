// 지휘 종목의 연주. 베토벤 「환희의 송가」(저작권이 끝난 곡)를 WebAudio로 직접 연주한다.
// 템포·크기는 지휘자가 정한 값을 계속 읽어 다음 음부터 바로 반영한다.
const ODE = [[64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1], [60, 1], [60, 1], [62, 1], [64, 1], [64, 1.5], [62, 0.5], [62, 2], [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1], [60, 1], [60, 1], [62, 1], [64, 1], [62, 1.5], [60, 0.5], [60, 2]];
const ODE_AT = (() => {
  const m = new Map();
  let b = 0;
  for (const [n, d] of ODE) {
    m.set(Math.round(b * 2), [n, d]);
    b += d;
  }
  return { m, len: Math.round(b * 2) };
})();
const ODE_BASS = [48, 43, 48, 43, 48, 43, 48, 48];
const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

export function createMusic() {
  let ac = null;
  let master = null;
  let noise = null;
  let timer = null;
  let next = 0;
  let step = 0;
  let beats = [];
  const state = { tempo: 80, vol: 0.35 };

  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === "suspended") ac.resume().catch(() => {});
    const b = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.3), ac.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise = b;
  } catch {
    ac = null; // 소리를 못 내도 지휘는 그대로 된다
  }

  function note(type, f, t, dur, gain) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function noiseHit(t, dur, gain, hp, dest = master) {
    const s = ac.createBufferSource();
    const f = ac.createBiquadFilter();
    const g = ac.createGain();
    s.buffer = noise;
    f.type = "highpass";
    f.frequency.value = hp;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t);
    s.stop(t + dur + 0.02);
  }
  function kick(t, gain) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.14);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.2);
  }
  function schedule() {
    if (!master) return;
    while (next < ac.currentTime + 0.12) {
      const spb = 60 / state.tempo;
      const e = step % ODE_AT.len;
      const t = next;
      const mel = ODE_AT.m.get(e);
      if (mel) {
        const f = mtof(mel[0] + 12);
        note("triangle", f, t, mel[1] * spb * 0.95, 0.22);
        note("sine", f * 2, t, mel[1] * spb * 0.6, 0.05);
      }
      if (e % 2 === 0) {
        const beat = e / 2;
        const root = ODE_BASS[Math.floor(beat / 4) % 8];
        note("triangle", mtof(beat % 2 ? root + 7 : root), t, spb * 0.9, 0.18);
        if (beat % 2 === 0) kick(t, 0.5);
        else noiseHit(t, 0.12, 0.18, 1500);
        beats.push(t);
      }
      noiseHit(t, 0.035, 0.05, 7000);
      next += spb / 2;
      step++;
    }
  }

  return {
    state,
    start() {
      if (!ac) return;
      ac.resume?.().catch?.(() => {});
      master = ac.createGain();
      master.gain.value = 0.0001;
      master.connect(ac.destination);
      step = 0;
      next = ac.currentTime + 0.1;
      beats = [];
      clearInterval(timer);
      timer = setInterval(schedule, 25);
    },
    stop() {
      clearInterval(timer);
      timer = null;
      if (master && ac) {
        const m = master;
        m.gain.setTargetAtTime(0.0001, ac.currentTime, 0.15);
        setTimeout(() => m.disconnect(), 1200);
      }
      master = null;
    },
    /** 매 프레임 호출: 크기 반영 + 지금 박자의 위치(0~1)를 돌려준다 */
    tick(tempo, vol) {
      state.tempo = tempo;
      state.vol = vol;
      if (!ac) return null;
      if (master) master.gain.setTargetAtTime(0.03 + 0.75 * Math.pow(vol, 1.3), ac.currentTime, 0.08);
      const ct = ac.currentTime;
      while (beats.length > 1 && beats[1] <= ct) beats.shift();
      if (master && beats.length && beats[0] <= ct) return Math.min(1, Math.max(0, (ct - beats[0]) / (60 / tempo)));
      return null;
    },
    applause() {
      if (!ac || !noise) return;
      const g = ac.createGain();
      g.gain.value = 0.3;
      g.connect(ac.destination);
      for (let i = 0; i < 110; i++) {
        const t = ac.currentTime + Math.random() * 2.8;
        noiseHit(t, 0.06, 0.5 * (1 - (t - ac.currentTime) / 3.2), 1200 + Math.random() * 2500, g);
      }
    },
    dispose() {
      this.stop();
      setTimeout(() => ac?.close?.().catch?.(() => {}), 1500);
    },
  };
}
