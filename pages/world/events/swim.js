// 50m 수영: F·J를 번갈아 눌러 젓고, 숨이 차면 잠깐 멈춰 숨을 쉰다. 규칙은 logic/swim.js.
import { LEN, DT, newSwim, start, pressKey, step, rankings, done, strokeRate } from "../logic/swim.js";
import { clamp } from "../logic/rng.js";

export const info = {
  id: "swim",
  name: "50m 수영",
  lede: "50m를 CPU 선수 3명과 겨뤄요. 계속 저으면 숨이 차니, 쉬는 타이밍을 잘 고르세요.",
  howto: [
    ["젓기", "F · J 번갈아 누르기 (← · → 도 가능)"],
    ["숨쉬기", "숨 게이지가 줄어들면 잠깐 멈추면 차올라요"],
    ["속도", "너무 빠르게 계속 저으면 힘이 빠져 오히려 느려져요"],
  ],
};

export function create(ctx) {
  const { THREE, hud, input, layout, sfx } = ctx;
  const { POOL } = layout;
  const off = [];
  let sim = null;
  let horses = []; // 0 = 내 말(ctx.player)
  let foams = [];
  let acc = 0;
  let state = "idle"; // idle | count | race | end
  let stopCount = null;
  let els = null;
  let endTimer = null;
  let clock = 0;
  let lastToast = 0;

  const laneZ = (i) => POOL.laneZ(i);
  const X0 = POOL.x0 + 0.9;
  const worldX = (x) => X0 + (x / LEN) * (POOL.x1 - POOL.x0 - 1.8);

  function foamTexture() {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 64;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(80, 32, 2, 80, 32, 62);
    gr.addColorStop(0, "rgba(255,255,255,.95)");
    gr.addColorStop(0.5, "rgba(255,255,255,.4)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 64);
    const t = new THREE.CanvasTexture(c);
    return t;
  }

  function makeFoam(tex) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.3), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.2 }));
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 3;
    ctx.scene.add(m);
    return m;
  }

  function clearActors() {
    horses.slice(1).forEach((h) => ctx.removeHorse(h));
    horses = [];
    foams.forEach((f) => {
      ctx.scene.remove(f);
      f.material.dispose();
    });
    foams = [];
  }

  function setup() {
    clearActors();
    sim = newSwim((Math.random() * 1e9) | 0);
    const tex = foamTexture();
    horses = [null, ...sim.swimmers.slice(1).map((s) => ctx.makeHorse(s.color))];
    foams = sim.swimmers.map(() => makeFoam(tex));
    acc = 0;
    clearTimeout(endTimer);
    endTimer = null;
    state = "idle";
    hud.clear();
    const wrap = hud.box("", "tl", "wf-stats");
    els = { time: hud.stat("시간", "0.00"), dist: hud.stat("거리", "0m"), rate: hud.stat("젓기", "0.0회/초"), rank: hud.stat("순위", "1/4") };
    for (const s of Object.values(els)) wrap.append(s.el);
    els.o2 = hud.meter("숨");
    hud.box("", "bl").append(els.o2.el);
    els.o2.set(1, "가득");
    hud.box(`<button class="ghost" data-act="evexit">종목 나가기</button>`, "tr").querySelector("button").addEventListener("click", ctx.exit);
    place(0);
    camera(true);
  }

  function place(dt) {
    const now = performance.now() / 1000;
    sim.swimmers.forEach((s, i) => {
      const swimming = sim.phase === "race" && s.finish === null;
      s.ph = s.ph === undefined ? s.phT : s.ph + Math.min(s.phT - s.ph, Math.max(5, (s.phT - s.ph) * 7) * dt);
      const roll = Math.sin(s.ph) * 0.28 * (swimming ? 1 : 0.25);
      const pose = {
        bob: -0.1 + 0.05 * s.breath + 0.03 * Math.sin(now * 3 + i) + (swimming ? Math.abs(Math.sin(s.ph)) * 0.06 : 0),
        lean: -0.18 - 0.05 * Math.min(1, s.v / 2) + 0.35 * s.breath,
        roll,
      };
      const x = worldX(s.x);
      if (i === 0) {
        ctx.player.setPose({ x, y: 0, z: laneZ(0), yaw: 0, ...pose });
        ctx.player.render(dt);
      } else horses[i].render(x, 0, laneZ(i), 0, pose);
      const f = foams[i];
      f.position.set(x - 0.5, 0.06, laneZ(i));
      f.material.opacity = clamp(s.v / 2.2, 0.1, 0.85);
      f.scale.set(0.8 + s.v * 0.3, 1, 1);
    });
    clock += dt;
  }

  function camera(snap) {
    const P = sim.swimmers[0];
    const px = worldX(P.x);
    if (state === "race" || state === "end") ctx.shot([px - 2.5, 2.7, laneZ(0) - 5.8], [px + 2.4, 0, laneZ(0) + 2.4], 4);
    else ctx.shot([POOL.x0 - 3, 4.4, (laneZ(0) + laneZ(3)) / 2 - 11], [POOL.x0 + 5, 0, (laneZ(0) + laneZ(3)) / 2], 3);
    if (snap) ctx.snapShot();
  }

  function begin() {
    setup();
    state = "count";
    camera(false);
    stopCount = hud.countdown(
      () => {
        state = "race";
        start(sim);
        hud.toast("F · J를 번갈아! 숨이 차면 잠깐 멈춰요", 2600);
      },
      { beep: sfx.beep, go: sfx.go },
    );
  }

  const onStep = ({ side }) => {
    if (state !== "race") return;
    const r = pressKey(sim, side);
    if (r === "ok") sfx.step();
    else if (r === "same" && performance.now() - lastToast > 600) {
      lastToast = performance.now();
      hud.toast("번갈아!", 500);
    }
  };

  function finish() {
    state = "end";
    const ranks = rankings(sim);
    const P = sim.swimmers[0];
    const place = ranks.indexOf(P) + 1;
    let record = null;
    if (P.finish !== null && ctx.submit("swim", P.finish)) record = "새 최고 기록!";
    const fmt = (s) => (s.finish === null ? "미완주" : `${s.finish.toFixed(2)}초`);
    hud.result({
      title: `${place}위`,
      record,
      rows: [...ranks.map((s, i) => [`${i + 1}. ${s.me ? "나" : s.name}`, fmt(s)]), ["젓기 횟수", `${P.strokes.length}번`], ["숨 쉰 횟수", `${P.breaths}번`]],
      note: "숨이 차오르기 전에 짧게 쉬면 더 빨라요.",
      onAgain: begin,
      onExit: ctx.exit,
    });
  }

  return {
    enter() {
      ctx.player.setPose({ x: POOL.x0 + 1, y: 0, z: laneZ(0), yaw: 0 });
      ctx.player.render(0);
      ctx.shot([POOL.x0 - 3, 4.4, laneZ(1) - 10], [POOL.x0 + 5, 0, laneZ(1)], 20);
      ctx.snapShot();
      off.push(input.on("step", onStep));
      off.push(
        input.on("key", ({ code }) => {
          if (code === "ArrowLeft") onStep({ side: "L" });
          if (code === "ArrowRight") onStep({ side: "R" });
        }),
      );
      hud.clear();
      hud.box(`<button class="ghost" data-act="evexit">종목 나가기</button>`, "tr").querySelector("button").addEventListener("click", ctx.exit);
      hud.intro({ title: info.name, lede: info.lede, howto: info.howto, best: ctx.bestText("swim"), onStart: begin, onExit: ctx.exit, startLabel: "출발대로" });
    },
    update(dt) {
      if (!sim) return;
      if (state === "race") {
        acc += Math.min(dt, 0.1);
        while (acc >= DT) {
          step(sim, DT);
          acc -= DT;
        }
        const P = sim.swimmers[0];
        const ranks = rankings(sim);
        els.time.set((P.finish ?? sim.t).toFixed(2));
        els.dist.set(`${Math.floor(Math.min(LEN, P.x))}m / ${LEN}`);
        els.rate.set(`${strokeRate(sim, P).toFixed(1)}회/초`);
        els.rank.set(`${ranks.indexOf(P) + 1}/4`);
        els.o2.set(P.o2, P.breath > 0.3 && P.finish === null ? "숨 쉬는 중…" : P.o2 < 0.3 ? "숨차요! 잠깐 멈추세요" : `${Math.round(P.o2 * 100)}%`, P.o2 < 0.3);
        if (P.finish !== null && !endTimer) {
          sfx.win();
          hud.toast(`터치! ${P.finish.toFixed(2)}초`, 1800);
        }
        if (done(sim) && !endTimer) endTimer = setTimeout(finish, 1200);
      }
      if (state !== "idle") {
        place(dt);
        camera(false);
      }
    },
    exit() {
      off.splice(0).forEach((f) => f());
      stopCount?.();
      clearTimeout(endTimer);
      endTimer = null;
      clearActors();
      ctx.freeCamera();
    },
  };
}
