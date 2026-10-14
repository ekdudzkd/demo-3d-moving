// 오케스트라 지휘: 마우스 높이 = 소리 크기, 흔드는 빠르기 = 템포. 규칙은 logic/orch.js, 연주는 music.js.
import { SECTIONS, TOTAL, sectionEnd, newConductor, begin as beginPlay, pointer, tap, update, summary } from "../logic/orch.js";
import { createMusic } from "../music.js";
import { clamp } from "../logic/rng.js";

export const info = {
  id: "orch",
  name: "오케스트라 지휘",
  lede: "4개 악장의 지시(크기·빠르기)에 맞춰 지휘하세요. 악단이 환희의 송가를 연주해요.",
  howto: [
    ["크기", "마우스를 위로 올리면 크게, 내리면 작게 (↑ ↓ 키도 가능)"],
    ["빠르기", "마우스를 빠르게 흔들면 빠르게, 멈추면 느려져요 (Space를 박자에 맞춰 두드려도 돼요)"],
    ["점수", "악장마다 목표 BPM ±12, 크기 ±10% 안이면 만점이에요"],
  ],
};

export function create(ctx) {
  const { THREE, hud, input, layout, sfx } = ctx;
  const { ORCH } = layout;
  const [OX, OZ] = ORCH.stage;
  const PX = OX - 1.5; // 지휘대 위치(scene.js의 podium)
  const PY = 0.7;
  const off = [];
  let c = null;
  let music = null;
  let els = null;
  let baton = null;
  let prev = null;
  let at = 0;
  let state = "idle";
  let active = false;

  function build() {
    hud.clear();
    els = {};
    els.sec = hud.box(`<small class="no"></small><strong class="nm"></strong><small class="mk"></small>`, "tl", "wf-orsec");
    els.no = els.sec.querySelector(".no");
    els.nm = els.sec.querySelector(".nm");
    els.mk = els.sec.querySelector(".mk");
    els.score = hud.stat("정확도", "-");
    hud.box("", "tc", "wf-stats").append(els.score.el);
    els.tl = hud.box(SECTIONS.map((x, i) => `<div data-i="${i}"><i></i><span>${x.name}</span></div>`).join(""), "bl", "wf-ortl");
    els.vol = hud.box(`<small>크기 <b class="v"></b></small><div class="wf-ormeter"><u class="band"></u><b class="dot"></b></div><small>빠르기 <b class="t"></b></small><div class="wf-ormeter"><u class="tband"></u><b class="tdot"></b></div>`, "br", "wf-orm");
    hud.box(`<button class="ghost" data-act="evexit">종목 나가기</button>`, "tr").querySelector("button").addEventListener("click", ctx.exit);
  }

  function makeBaton() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.85, 8).rotateZ(-Math.PI / 2).translate(0.42, 0, 0), new THREE.MeshLambertMaterial({ color: "#fafafa" }));
    m.castShadow = true;
    g.add(m);
    ctx.scene.add(g);
    return g;
  }

  function startConducting() {
    music?.dispose();
    music = createMusic();
    c = newConductor();
    build();
    beginPlay(c);
    state = "conduct";
    prev = null;
    hud.toast("마우스를 올려 크게, 흔들어 빠르게!", 2800);
  }

  function updateHud() {
    const k = c.phase === "play" ? c.sec : 0;
    const S = SECTIONS[k];
    els.no.textContent = `${k + 1} / ${SECTIONS.length}악장${c.phase === "play" ? ` · ${Math.max(0, Math.ceil(sectionEnd(k) - c.t))}초 남음` : c.phase === "intro" ? " · 곧 시작" : ""}`;
    els.nm.textContent = S.name;
    els.mk.textContent = `${S.mark} · 목표 ${S.bpm} BPM`;
    const tp = (b) => clamp(((b - 60) / 120) * 100, 0, 100);
    els.vol.querySelector(".dot").style.left = `${c.vol * 100}%`;
    els.vol.querySelector(".v").textContent = `${Math.round(c.vol * 100)}%`;
    const band = els.vol.querySelector(".band");
    band.style.left = `${(S.vol - 0.1) * 100}%`;
    band.style.width = "20%";
    els.vol.querySelector(".tdot").style.left = `${tp(c.tempo)}%`;
    els.vol.querySelector(".t").textContent = `${Math.round(c.tempo)} BPM`;
    const tb = els.vol.querySelector(".tband");
    tb.style.left = `${tp(S.bpm - 12)}%`;
    tb.style.width = `${tp(S.bpm + 12) - tp(S.bpm - 12)}%`;
    const done = c.acc.reduce((a, x) => a + x.n, 0);
    const got = c.acc.reduce((a, x) => a + x.s, 0);
    els.score.set(done > 0.5 ? `${Math.round((got / done) * 100)}%` : "-");
    SECTIONS.forEach((x, i) => {
      const el = els.tl.querySelector(`[data-i="${i}"]`);
      const st = i ? sectionEnd(i - 1) : 0;
      const f = c.phase === "play" || c.phase === "end" ? clamp((c.t - st) / x.dur, 0, 1) : 0;
      el.firstChild.style.width = `${f * 100}%`;
      el.classList.toggle("cur", c.phase === "play" && i === k);
    });
  }

  function finish() {
    state = "end";
    music.stop();
    music.applause();
    sfx.win();
    const r = summary(c);
    const record = ctx.submit("orch", r.score) ? "새 최고 기록!" : null;
    hud.result({
      title: `${r.grade} 등급 · ${r.score}점`,
      record,
      rows: [
        ...r.sections.map((x, i) => [`${i + 1}악장 ${x.mark.split(" · ")[1]}`, `${x.bpm} BPM · ${x.vol}% → ${x.score}점`]),
        ["평균", `${r.avgBpm} BPM · 소리 ${r.avgVol}%`],
      ],
      note: { S: "박수갈채! 지휘자 데뷔 성공", A: "관객이 일어나 박수를 쳐요", B: "조금만 더 악보를 따라가면 돼요", C: "오케스트라가 헷갈려해요" }[r.grade],
      onAgain: startConducting,
      onExit: ctx.exit,
    });
  }

  function placeAll(dt, beatPhase) {
    const p = ctx.player;
    const spb = 60 / c.tempo;
    const ph = c.phase === "play" && beatPhase !== null ? beatPhase : (at / spb) % 1;
    const pulse = Math.exp(-ph * 5);
    const playing = c.phase === "play";
    p.setPose({
      x: PX,
      y: PY,
      z: OZ,
      yaw: 0,
      bob: -0.06 * pulse,
      lean: -0.05 + 0.25 * c.vol - 0.1 * pulse,
      roll: playing ? Math.sin(at * (c.tempo / 60) * Math.PI) * 0.06 : 0,
      scaleY: 1 + 0.1 * c.vol,
    });
    p.render(dt);
    // 지휘봉: 손 높이만큼 올라가고 박마다 툭 떨어진다
    const bx = PX + p.half[0] + 0.35;
    const by = PY + p.height * (0.35 + 0.85 * c.height) - 0.25 * pulse;
    baton.position.set(bx, by, OZ + 0.15);
    baton.rotation.z = 0.85 - 0.5 * pulse + 0.2 * c.height;
    // 악단 15마리(장식): 박자에 맞춰 들썩이고 소리가 클수록 크게 뛴다
    const mus = ctx.world.venue.musicians || [];
    mus.forEach((g, i) => {
      const q = (ph + i * 0.13) % 1;
      g.position.y = 0.4 + (playing ? (0.03 + 0.12 * c.vol) * Math.pow(1 - q, 2) : 0.01 * Math.sin(at * 2 + i));
    });
  }

  return {
    enter() {
      active = true;
      ctx.player.setPose({ x: PX, y: PY, z: OZ, yaw: 0 });
      ctx.player.render(0);
      ctx.shot([PX - 6.8, PY + 3.0, OZ + 2.4], [OX + 3, 1.0, OZ], 20);
      ctx.snapShot();
      baton = makeBaton();
      c = newConductor();
      off.push(
        input.on("move", (p) => {
          if (state !== "conduct" || c.phase === "end") return;
          const now = performance.now();
          const aspect = ctx.renderer.domElement.clientWidth / Math.max(1, ctx.renderer.domElement.clientHeight);
          let speed = 0;
          if (prev) speed = Math.hypot((p.x - prev.x) * aspect, p.y - prev.y) / Math.max(0.008, (now - prev.t) / 1000);
          prev = { x: p.x, y: p.y, t: now };
          pointer(c, p.y, speed);
        }),
        input.on("key", ({ code }) => {
          if (state !== "conduct") return;
          if (code === "Space") tap(c, performance.now());
        }),
      );
      hud.clear();
      hud.box(`<button class="ghost" data-act="evexit">종목 나가기</button>`, "tr").querySelector("button").addEventListener("click", ctx.exit);
      hud.intro({ title: info.name, lede: info.lede, howto: info.howto, best: ctx.bestText("orch"), onStart: startConducting, onExit: ctx.exit, startLabel: "지휘대에 서기" });
    },
    update(dt) {
      if (!active) return;
      at += dt;
      if (state === "conduct" || state === "end") {
        c.keyVol = (input.isHeld("ArrowUp") ? 1 : 0) - (input.isHeld("ArrowDown") ? 1 : 0);
        const wasPlay = c.phase;
        if (state === "conduct") update(c, dt, performance.now());
        else {
          c.speed *= Math.exp(-dt / 0.25);
        }
        if (wasPlay === "intro" && c.phase === "play") music.start();
        const bp = music.tick(c.tempo, c.vol);
        placeAll(dt, bp);
        if (state === "conduct") {
          updateHud();
          if (c.phase === "end") finish();
        }
      } else {
        // 시작 전: 지휘대에 서서 숨 고르기
        c.vol = 0.35;
        placeAll(dt, null);
      }
      ctx.shot([PX - 6.8, PY + 3.0, OZ + 2.4], [OX + 3, 1.0, OZ], 4);
    },
    exit() {
      active = false;
      off.splice(0).forEach((f) => f());
      music?.dispose();
      music = null;
      if (baton) {
        ctx.scene.remove(baton);
        baton = null;
      }
      (ctx.world.venue.musicians || []).forEach((g) => (g.position.y = 0.4));
      ctx.freeCamera();
    },
  };
}
