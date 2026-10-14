// 양궁: 누른 채 끌어서 조준, 떼면 발사. 30m 앞 과녁에 6발. 규칙은 logic/arch.js.
import { D, FACE_R, RING, ARROWS, newSession, nextArrow, startDraw, cancelDraw, nudge, drag, setPull, tick, reticle, release, scoreOf, total, label, cpuField } from "../logic/arch.js";
import { clamp } from "../logic/rng.js";

export const info = {
  id: "arch",
  name: "양궁",
  lede: "30m 앞 과녁에 화살 6발을 쏴요. 바람과 손떨림을 읽고 가운데를 노리세요.",
  howto: [
    ["조준·발사", "마우스를 누른 채 끌어서 조준, 떼면 발사 (또는 Space 누름·뗌 + 방향키로 조준)"],
    ["당김", "누르고 있으면 힘이 차올라요. 너무 짧으면 쏠 수 없고, 오래 버티면 손이 떨려요"],
    ["바람", "화면의 바람 방향으로 화살이 밀려요. 점수는 같으면 정중앙(X) 수로 가려요"],
  ],
};

const RING_COLORS = (i) => (i <= 2 ? "#f4f4f0" : i <= 4 ? "#1d1f24" : i <= 6 ? "#3aa0e0" : i <= 8 ? "#e2412f" : "#ffd23c");

function drawFace(g, cx, cy, k) {
  for (let i = 1; i <= 10; i++) {
    g.beginPath();
    g.arc(cx, cy, (11 - i) * RING * k, 0, 7);
    g.fillStyle = RING_COLORS(i);
    g.fill();
    g.lineWidth = Math.max(1, k * 0.003);
    g.strokeStyle = i === 3 || i === 4 ? "#f4f4f0" : "#16181d";
    g.stroke();
  }
}

export function create(ctx) {
  const { THREE, hud, input, layout, sfx } = ctx;
  const { ARCH } = layout;
  const [SX, SZ] = ARCH.shooter;
  const [TX, TZ] = ARCH.target;
  const K = ARCH.targetR / FACE_R; // 원작 미터 → 월드 미터
  const off = [];
  let s = null;
  let state = "idle"; // idle | aim | flight | hit | end
  let els = null;
  let bow = null;
  let flyArrow = null;
  let nockArrow = null;
  let stuck = null;
  let fl = null;
  let hitT = 0;
  let ptr = null;
  let pinch = null;
  let scope = null;
  let scopeG = null;
  const tmp = new THREE.Vector3();

  function makeArrow() {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.75, 6).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: "#2b2b2b" }));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.045, 6).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: "#c0c4cc" }));
    tip.position.z = 0.395;
    g.add(shaft, tip);
    const vm = new THREE.MeshLambertMaterial({ color: "#e2412f", side: THREE.DoubleSide });
    for (let k = 0; k < 3; k++) {
      const v = new THREE.Group();
      v.add(new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.026).rotateY(Math.PI / 2).translate(0, 0.013, -0.31), vm));
      v.rotation.z = (k * Math.PI * 2) / 3;
      g.add(v);
    }
    const wrap = new THREE.Group();
    g.scale.setScalar(1.8); // 월드 규격에 맞춰 눈에 띄게 키운다
    wrap.add(g);
    return wrap;
  }

  function buildProps() {
    const h = ctx.player.height;
    bow = new THREE.Group();
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 10 - 1;
      pts.push(new THREE.Vector3(0, t * 0.85, 0.28 * t * t));
    }
    bow.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.025, 6), new THREE.MeshStandardMaterial({ color: "#7a3fd1", roughness: 0.5 })));
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    bow.string = new THREE.Line(sg, new THREE.LineBasicMaterial({ color: "#fafafa" }));
    bow.string.frustumCulled = false;
    bow.add(bow.string);
    ctx.scene.add(bow);
    flyArrow = makeArrow();
    flyArrow.visible = false;
    nockArrow = makeArrow();
    stuck = new THREE.Group();
    ctx.scene.add(flyArrow, nockArrow, stuck);
    bow.userData.h = h;
  }
  function disposeProps() {
    for (const o of [bow, flyArrow, nockArrow, stuck]) o && ctx.scene.remove(o);
    bow = flyArrow = nockArrow = stuck = null;
  }

  const gripPos = () => {
    const p = ctx.player;
    return new THREE.Vector3(SX + p.half[0] + 0.45, p.height * 0.62, SZ);
  };
  const targetPoint = (hx, hy) => new THREE.Vector3(TX - 0.05, ARCH.targetY + hy * K, TZ + hx * K);

  function placeBow(dt) {
    const ret = reticle(s);
    const G = gripPos();
    const T = targetPoint(ret.x, ret.y);
    bow.position.copy(G);
    bow.lookAt(T);
    const pull = state === "aim" && s.drawing ? s.power : 0;
    const tipZ = 0.28;
    const nz = tipZ - 0.95 * pull;
    const p = bow.string.geometry.attributes.position;
    p.setXYZ(0, 0, 0.85, tipZ);
    p.setXYZ(1, 0, 0, nz);
    p.setXYZ(2, 0, -0.85, tipZ);
    p.needsUpdate = true;
    if (nockArrow.visible) {
      nockArrow.position.copy(bow.localToWorld(tmp.set(0, 0, nz + 0.675)));
      nockArrow.quaternion.copy(bow.quaternion);
    }
    const pw = s.drawing ? s.power : 0;
    ctx.player.setPose({ x: SX, y: 0, z: SZ, yaw: 0, bob: 0.02 * Math.sin(s.t * 2), lean: 0.12 * pw + 0.03, roll: 0 });
    ctx.player.render(dt);
  }

  function msg(text, ms = 0) {
    els.msg.textContent = text;
    els.msg.hidden = !text;
    clearTimeout(msg.t);
    if (ms) msg.t = setTimeout(() => (els.msg.hidden = true), ms * 1000);
  }

  function card() {
    const cells = [];
    for (let i = 0; i < ARROWS; i++) {
      const sc = s.scores[i];
      cells.push(`<div class="${i === s.scores.length && state !== "end" ? "cur" : ""}">${sc ? label(sc) : ""}</div>`);
    }
    els.card.innerHTML = cells.join("") + `<div class="tot">${total(s.scores)}점</div>`;
  }

  function build() {
    hud.clear();
    els = {};
    els.card = hud.box("", "tl", "wf-arcard");
    const stats = hud.box("", "tc", "wf-stats");
    els.wind = hud.stat("바람", "-");
    els.count = hud.stat("화살", `1 / ${ARROWS}`);
    stats.append(els.wind.el, els.count.el);
    els.pow = hud.meter("당김");
    const bl = hud.box("", "bl");
    bl.append(els.pow.el);
    const sc = hud.box(`<canvas width="360" height="360" style="width:180px;height:180px;display:block;border-radius:10px"></canvas><small style="display:block;text-align:center;margin-top:4px">조준 확대</small>`, "br", "wf-scope");
    scope = sc.querySelector("canvas");
    scopeG = scope.getContext("2d");
    els.msg = hud.box("", "center", "wf-msg-line");
    els.msg.hidden = true;
    els.msg.style.pointerEvents = "none";
    els.msg.style.top = "30%";
    hud.box(`<button class="ghost" data-act="evexit">종목 나가기</button>`, "tr").querySelector("button").addEventListener("click", ctx.exit);
  }

  function nextTurn() {
    nextArrow(s);
    state = "aim";
    nockArrow.visible = true;
    flyArrow.visible = false;
    els.count.set(`${s.scores.length + 1} / ${ARROWS}`);
    msg(`${s.scores.length + 1}번째 화살 — 누른 채 끌어서 조준, 떼면 발사`, 2.4);
    card();
  }

  function begin() {
    s = newSession((Math.random() * 1e9) | 0);
    disposeProps();
    buildProps();
    build();
    card();
    placeBow(0);
    state = "aim";
    nextTurn();
    camera(true);
  }

  function fire(shot) {
    const G = bow.position.clone();
    const dir = targetPoint(shot.hx, shot.hy).sub(G).normalize();
    const from = G.clone().addScaledVector(dir, 0.4);
    const to = shot.onBoss ? targetPoint(shot.hx, shot.hy) : new THREE.Vector3(TX + 3.4, Math.max(0.15, ARCH.targetY + shot.hy * 1.12 * K), TZ + shot.hx * 1.12 * K);
    fl = { t: 0, Tv: clamp(shot.T * 2.6, 0.9, 1.8), from, to, sag: shot.sag * K * 0.6, shot };
    state = "flight";
    nockArrow.visible = false;
    flyArrow.visible = true;
    sfx.bow?.();
  }

  function flightPos(u) {
    const pos = fl.from.clone().lerp(fl.to, u);
    pos.y += fl.sag * u * (1 - u);
    const d = fl.to.clone().sub(fl.from);
    d.y += fl.sag * (1 - 2 * u);
    return [pos, d.normalize()];
  }

  function arrive() {
    const sc = scoreOf(fl.shot);
    s.scores.push(sc);
    const [, d] = flightPos(1);
    const m = makeArrow();
    m.position.copy(fl.to).addScaledVector(d, -0.45);
    m.lookAt(fl.to.clone().add(d));
    stuck.add(m);
    flyArrow.visible = false;
    state = "hit";
    hitT = 0;
    hud.toast(sc.v ? (sc.X ? "X 텐!" : `${sc.v}점`) : "빗나감", 1300);
    (sc.v >= 9 ? sfx.win : sfx.thud)();
    card();
  }

  function end() {
    state = "end";
    const tot = total(s.scores);
    const xs = s.scores.filter((v) => v.X).length;
    const tens = s.scores.filter((v) => v.v === 10).length;
    const field = [{ name: "나", total: tot, x: xs, me: true }, ...cpuField(s.rng)].sort((a, b) => b.total - a.total || b.x - a.x);
    const rank = field.findIndex((f) => f.me) + 1;
    const record = ctx.submit("arch", tot) ? "새 최고 기록!" : null;
    card();
    hud.result({
      title: `${rank}위`,
      record,
      rows: [
        ...field.map((f, i) => [`${i + 1}. ${f.me ? "나" : f.name}`, `${f.total}점 (X ${f.x})`]),
        ["내 점수표", s.scores.map(label).join(" · ")],
        ["10점", `${tens}발 · 그중 X ${xs}발`],
      ],
      note: "같은 점수면 정중앙 X 개수가 많은 쪽이 이겨요.",
      onAgain: begin,
      onExit: ctx.exit,
    });
  }

  function drawScope() {
    if (!scopeG) return;
    const S = 360;
    const span = 0.8;
    const k = S / 2 / span;
    const c = S / 2;
    const g = scopeG;
    g.fillStyle = "#d9b26a";
    g.fillRect(0, 0, S, S);
    g.fillStyle = "#efe6cf";
    g.fillRect(c - 0.66 * k, c - 0.66 * k, 1.32 * k, 1.32 * k);
    drawFace(g, c, c, k);
    g.font = '600 13px sans-serif';
    s.scores.forEach((sc, i) => {
      const x = c + sc.hx * k;
      const y = c - sc.hy * k;
      g.beginPath();
      g.arc(x, y, 5, 0, 7);
      g.fillStyle = "#16181d";
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = "#fff";
      g.stroke();
      g.fillStyle = "#16181d";
      g.fillText(i + 1, x + 7, y - 6);
    });
    if (state === "aim") {
      const r = reticle(s);
      const x = clamp(c + r.x * k, 8, S - 8);
      const y = clamp(c - r.y * k, 8, S - 8);
      const full = s.power >= 0.99;
      g.lineWidth = 3;
      g.strokeStyle = full ? "#18a558" : "#16181d";
      g.beginPath();
      g.arc(x, y, 14, 0, 7);
      g.moveTo(x - 24, y);
      g.lineTo(x - 6, y);
      g.moveTo(x + 6, y);
      g.lineTo(x + 24, y);
      g.moveTo(x, y - 24);
      g.lineTo(x, y - 6);
      g.moveTo(x, y + 6);
      g.lineTo(x, y + 24);
      g.stroke();
      if (s.drawing) {
        g.lineWidth = 5;
        g.strokeStyle = full ? "#18a558" : "#e2412f";
        g.beginPath();
        g.arc(x, y, 30, -Math.PI / 2, -Math.PI / 2 + s.power * Math.PI * 2);
        g.stroke();
      }
    }
  }

  function camera(snap) {
    if (state === "flight") {
      const [p0, d] = flightPos(clamp(fl.t / fl.Tv, 0, 1));
      ctx.shot([p0.x - d.x * 2.2 - 0.3, p0.y + 0.45, p0.z - d.z * 2.2 + 0.6], [p0.x + d.x * 3, p0.y, p0.z + d.z * 3], 14);
    } else if (state === "hit" || state === "end") {
      ctx.shot([TX - 4.2, ARCH.targetY + 0.5, TZ + 1.8], [TX, ARCH.targetY, TZ], 5);
    } else ctx.shot([SX - 6.2, 2.7, SZ + 2.8], [SX + 14, 1.5, SZ], 5);
    if (snap) ctx.snapShot();
  }

  const heldAxis = () => ({
    x: (input.isHeld("ArrowRight") ? 1 : 0) - (input.isHeld("ArrowLeft") ? 1 : 0),
    y: (input.isHeld("ArrowUp") ? 1 : 0) - (input.isHeld("ArrowDown") ? 1 : 0),
  });

  return {
    enter() {
      ctx.player.setPose({ x: SX, y: 0, z: SZ, yaw: 0 });
      ctx.player.render(0);
      ctx.shot([SX - 6.2, 2.7, SZ + 2.8], [SX + 14, 1.5, SZ], 20);
      ctx.snapShot();
      off.push(
        input.on("down", (p) => {
          if (state !== "aim") return;
          sfx.resume?.();
          ptr = { x: p.cx, y: p.cy };
          startDraw(s);
        }),
        input.on("move", (p) => {
          if (!ptr || !s.drawing) return;
          drag(s, (p.cx - ptr.x) * 0.0028, -(p.cy - ptr.y) * 0.0028);
          ptr = { x: p.cx, y: p.cy };
        }),
        input.on("up", () => {
          if (!ptr) return;
          ptr = null;
          doRelease();
        }),
        input.on("key", ({ code }) => {
          if (code === "Space" && state === "aim" && !s.drawing) startDraw(s);
        }),
        input.on("pinch", (e) => {
          if (state !== "aim") return;
          if (e.phase === "start") {
            pinch = { ax: s.aim.x, ay: s.aim.y };
            startDraw(s);
          } else if (e.phase === "move" && pinch && s.drawing) {
            s.aim.x = clamp(pinch.ax + e.dx, -1.2, 1.2);
            s.aim.y = clamp(pinch.ay + e.dy, -1.2, 1.2);
            setPull(s, e.pull);
          } else if (e.phase === "end" && pinch) {
            pinch = null;
            doRelease();
          } else if (e.phase === "cancel") {
            pinch = null;
            cancelDraw(s);
          }
        }),
        input.on("keyup", ({ code }) => {
          if (code === "Space" && state === "aim" && s.drawing && !ptr) doRelease();
        }),
      );
      hud.clear();
      hud.box(`<button class="ghost" data-act="evexit">종목 나가기</button>`, "tr").querySelector("button").addEventListener("click", ctx.exit);
      hud.intro({ title: info.name, lede: info.lede, howto: info.howto, best: ctx.bestText("arch"), onStart: begin, onExit: ctx.exit, startLabel: "사대에 서기" });
    },
    update(dt) {
      if (!s || state === "idle") return;
      if (state === "aim") {
        const a = heldAxis();
        if (a.x || a.y) nudge(s, a.x * 0.45 * dt, a.y * 0.45 * dt);
        tick(s, dt);
        els.pow.set(s.power, `${Math.round(s.power * 100)}%`);
        els.wind.set(s.wind === 0 ? "없음" : `${s.wind > 0 ? "→" : "←"} ${Math.abs(s.wind).toFixed(1)}m/s`);
      } else {
        s.t += dt;
        els.pow.set(0, "0%");
      }
      if (state === "flight") {
        fl.t += dt;
        const u = clamp(fl.t / fl.Tv, 0, 1);
        const [pos, d] = flightPos(u);
        flyArrow.position.copy(pos);
        flyArrow.lookAt(pos.clone().add(d));
        if (u >= 1) arrive();
      } else if (state === "hit") {
        hitT += dt;
        if (hitT > 1.7) s.scores.length >= ARROWS ? end() : nextTurn();
      }
      placeBow(dt);
      drawScope();
      camera(false);
    },
    exit() {
      off.splice(0).forEach((f) => f());
      clearTimeout(msg.t);
      disposeProps();
      ctx.freeCamera();
    },
  };

  function doRelease() {
    if (state !== "aim" || !s.drawing) return;
    const shot = release(s);
    if (!shot) return;
    if (shot.tooWeak) {
      msg("조금 더 당겨야 쏠 수 있어요", 1.4);
      return;
    }
    fire(shot);
  }
}
