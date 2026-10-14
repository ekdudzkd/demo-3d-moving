// 줄다리기: F·J·Space를 빠르게 연타해 30초 안에 줄을 내 쪽으로 끌어오세요. 규칙은 logic/tug.js.
import { WIN, DUR, DT, newTug, start, pull, step, clearTime } from "../logic/tug.js";
import { clamp } from "../logic/rng.js";

export const info = {
  id: "tug",
  name: "줄다리기",
  lede: "우리 팀(파랑)이 CPU 팀(빨강)과 겨뤄요. 빠르게 연타할수록 힘이 세져요.",
  howto: [
    ["당기기", "F · J · Space 연타"],
    ["이기는 법", "줄 리본을 내 쪽 선까지 끌어오면 승리, 30초가 지나면 리본이 더 가까운 쪽이 이겨요"],
    ["참고", "CPU는 가끔 힘을 몰아 쓰고 끝으로 갈수록 조금 지쳐요"],
  ],
};

export function create(ctx) {
  const { THREE, hud, input, layout, sfx } = ctx;
  const [CX, CZ] = layout.TUG.center;
  const off = [];
  let sim = null;
  let horses = []; // [팀][멤버], (0,0)은 내 말(ctx.player)
  let acc = 0;
  let state = "idle"; // idle | count | pull | end
  let stopCount = null;
  let els = null;
  let endTimer = null;
  let clock = 0;
  let myRing = null;
  const gap = () => Math.max(1.9, Math.max(...ctx.player.half) * 2 + 0.35);

  function setup() {
    horses.flat().forEach((h) => h && h.dispose && h !== ctx.player && ctx.removeHorse(h));
    horses = [];
    clearTimeout(endTimer);
    endTimer = null;
    sim = newTug((Math.random() * 1e9) | 0);
    horses = [
      [null, ctx.makeHorse("#1f4fd1"), ctx.makeHorse("#1f4fd1")],
      [ctx.makeHorse("#e2412f"), ctx.makeHorse("#e2412f"), ctx.makeHorse("#e2412f")],
    ];
    if (!myRing) {
      myRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.8, 28), new THREE.MeshBasicMaterial({ color: "#1f4fd1", transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
      myRing.rotation.x = -Math.PI / 2;
      ctx.scene.add(myRing);
    }
    acc = 0;
    state = "idle";
    hud.clear();
    els = { time: hud.stat("남은 시간", String(DUR)), pulls: hud.stat("당긴 횟수", "0") };
    const wrap = hud.box("", "tl", "wf-stats");
    wrap.append(els.time.el, els.pulls.el);
    els.line = hud.box(`<div class="wf-tugline"><span>우리</span><div><b class="mark"></b></div><span>CPU</span></div>`, "tc", "wf-tugbox");
    els.mark = els.line.querySelector(".mark");
    els.pow = hud.meter("내 힘");
    hud.box("", "bl").append(els.pow.el);
    hud.box(`<button class="ghost" data-act="evexit">종목 나가기</button>`, "tr").querySelector("button").addEventListener("click", ctx.exit);
    place(0);
    camera(true);
  }

  function place(dt) {
    const t = performance.now() / 1000;
    clock += dt;
    const g = gap();
    sim.teams.forEach((T, k) => {
      const side = k === 0 ? -1 : 1;
      const dragged = clamp((k === 0 ? sim.v : -sim.v) / 0.6, 0, 1);
      const power = clamp(T.f / 4, 0, 1);
      horses[k].forEach((h, i) => {
        const x = CX + sim.X + side * (1.5 + i * g);
        const z = CZ + (i % 2 ? 0.45 : -0.45);
        let pose;
        if (sim.phase === "end" && sim.winner === (k === 0 ? 0 : 1)) {
          pose = { bob: 0.18 * Math.abs(Math.sin(t * 8 + i)), lean: 0.1 * Math.sin(t * 8 + i), roll: 0 };
        } else {
          const jerk = clamp(T.jerk - i * 0.25, 0, 1);
          pose = { bob: 0.05 * jerk, lean: 0.22 + 0.2 * power + 0.28 * dragged + (sim.phase === "end" ? 0.2 : 0), roll: 0.04 * Math.sin(t * 5 + i) };
        }
        const yaw = k === 0 ? 0 : Math.PI;
        if (k === 0 && i === 0) {
          ctx.player.setPose({ x, y: 0, z, yaw, ...pose });
          ctx.player.render(dt);
          myRing.position.set(x, 0.04, z);
        } else h.render(x, 0, z, yaw, pose);
      });
    });
    const v = ctx.world.venue;
    v.ribbon.position.x = CX + sim.X;
    if (els) {
      v.rope.position.x = CX + sim.X;
    }
  }

  function camera(snap) {
    ctx.shot([CX + sim.X * 0.5, 3.4, CZ + 11], [CX + sim.X * 0.5, 0.8, CZ], 3);
    if (snap) ctx.snapShot();
  }

  function begin() {
    setup();
    state = "count";
    stopCount = hud.countdown(
      () => {
        state = "pull";
        start(sim);
        hud.toast("F · J · Space를 연타!", 2200);
      },
      { beep: sfx.beep, go: sfx.go },
    );
  }

  const onPull = () => {
    if (state !== "pull") return;
    if (pull(sim, 0)) sfx.step();
  };

  function finish() {
    state = "end";
    const w = sim.winner;
    const win = w === 0;
    (win ? sfx.win : sfx.lose)();
    const full = clearTime(sim);
    let record = null;
    if (full !== null && ctx.submit("tug", full)) record = "새 최고 기록!";
    const how = full !== null ? `${full.toFixed(1)}초 만에 끌어왔어요` : "30초가 지나 리본이 더 가까운 쪽이 이겼어요";
    hud.result({
      title: w === -1 ? "무승부" : win ? "우리 팀 승리!" : "CPU 팀 승리",
      record,
      rows: [
        ["결과", w === -1 ? "리본이 한가운데" : how],
        ["내가 당긴 횟수", `${sim.teams[0].pulls}번`],
        ["평균 속도", `${(sim.teams[0].pulls / Math.max(1, sim.t)).toFixed(1)}회/초`],
      ],
      note: "기록은 줄을 끝까지 끌어온 승리만 저장돼요 (빠를수록 좋은 기록).",
      onAgain: begin,
      onExit: ctx.exit,
    });
  }

  return {
    enter() {
      ctx.player.setPose({ x: CX - 3, y: 0, z: CZ, yaw: 0 });
      ctx.player.render(0);
      ctx.shot([CX, 3.4, CZ + 11], [CX, 0.8, CZ], 20);
      ctx.snapShot();
      off.push(input.on("step", onPull));
      off.push(input.on("jump", onPull));
      hud.clear();
      hud.box(`<button class="ghost" data-act="evexit">종목 나가기</button>`, "tr").querySelector("button").addEventListener("click", ctx.exit);
      hud.intro({ title: info.name, lede: info.lede, howto: info.howto, best: ctx.bestText("tug"), onStart: begin, onExit: ctx.exit, startLabel: "줄 잡기" });
    },
    update(dt) {
      if (!sim) return;
      if (state === "pull" || state === "end") {
        acc += Math.min(dt, 0.1);
        while (acc >= DT) {
          step(sim, DT);
          acc -= DT;
        }
        els.time.set(state === "pull" ? String(Math.max(0, Math.ceil(DUR - sim.t))) : "끝");
        els.pulls.set(String(sim.teams[0].pulls));
        els.pow.set(clamp(sim.teams[0].f / 5, 0, 1), "");
        if (sim.phase === "end" && state === "pull") {
          state = "end";
          endTimer = setTimeout(finish, 1600);
        }
      }
      if (state !== "idle") {
        els.mark.style.left = `${clamp(50 + (sim.X / WIN) * 40, 2, 98)}%`;
        place(dt);
        camera(false);
      }
    },
    exit() {
      off.splice(0).forEach((f) => f());
      stopCount?.();
      clearTimeout(endTimer);
      horses.flat().forEach((h) => h && ctx.removeHorse(h));
      horses = [];
      if (myRing) {
        ctx.scene.remove(myRing);
        myRing.geometry.dispose();
        myRing.material.dispose();
        myRing = null;
      }
      const v = ctx.world.venue;
      v.rope.visible = true;
      v.rope.position.x = CX;
      v.ribbon.position.x = CX;
      ctx.freeCamera();
    },
  };
}
