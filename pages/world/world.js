import * as THREE from "three";
import { buildScene } from "./scene.js";
import { cloneHorse, createPlayer } from "./player.js";
import { createInput } from "./input.js";
import { createHud } from "./hud.js";
import * as layout from "./layout.js";
import { BOUNDS, SPAWN, ZONES } from "./layout.js";
import { EVENTS } from "./events/index.js";
import { RECORD_RULES, bestOf, bestText, submitRecord } from "./records.js";
import { sfx } from "./sfx.js";
import { createHands } from "./hands.js";

const TEMPLATE = `
<canvas class="wf-canvas" aria-label="월드"></canvas>
<div class="wf-top">
  <div class="wf-left">
    <div class="wf-gems" aria-live="polite"></div>
    <details class="wf-zones" open><summary>종목 위치</summary><ul></ul></details>
  </div>
  <div class="wf-actions">
    <button class="ghost" data-act="hand" aria-pressed="false">카메라: 꺼짐</button>
    <button class="ghost" data-act="edit">말 모양 고치기</button>
    <button class="ghost" data-act="full">전체화면</button>
    <button class="primary" data-act="close">나가기</button>
  </div>
</div>
<div class="wf-prompt" hidden><button class="primary"></button></div>
<div class="wf-help"></div>
<div class="wf-event"></div>
<div class="wf-rcol"><details class="wf-ctl" open hidden><summary>조작법 <kbd>H</kbd></summary><dl></dl></details></div>
<div class="wf-toasts" aria-live="polite"></div>
<aside class="wf-drawer" hidden aria-label="말 모양 고치기">
  <header><b>말 모양 고치기</b><button class="ghost" data-act="dclose" aria-label="닫기">닫기</button></header>
  <p class="wf-dnote">말로 모양을 바꾸면 월드의 말이 바로 바뀝니다. 6방향 설계도 편집과 같은 규칙이에요.</p>
  <div class="wf-chat" aria-live="polite"></div>
  <div class="wf-chips"></div>
  <form class="wf-dform"><input aria-label="편집 요청" autocomplete="off" placeholder="예: 세워줘, 더 두껍게"><button class="primary" type="submit">보내기</button></form>
  <div class="wf-row"><button class="ghost" data-act="undo">되돌리기</button></div>
</aside>`;

/** 종목 중 오른쪽 위에 늘 보이는 조작법. key: 키보드·마우스, hand: 손가락(카메라), body: 몸(카메라) */
const CONTROLS = {
  run: { key: [["달리기", "F · J 번갈아 (← · → 도 가능)"], ["요령", "일정한 박자로. 같은 쪽 연타는 비틀거려요"]], hand: "검지·중지를 번갈아 내밀기", body: "제자리에서 무릎을 번갈아 들며 뛰기 (다리가 안 보이면 두 팔을 번갈아 위아래로 흔들기)" },
  hj: { key: [["도움닫기", "F · J 번갈아"], ["점프", "Space — 아래 막대가 초록일 때"]], hand: "검지·중지로 달리다가 손 전체를 위로 휙", body: "제자리 뛰기로 달리다가 두 팔을 머리 위로 번쩍(또는 진짜 점프)" },
  arch: { key: [["조준·당김", "마우스를 누른 채 끌기"], ["발사", "마우스 떼기 (Space 누름·뗌 + 방향키 조준도 가능)"]], hand: "엄지·검지를 집고 몸쪽으로 당기며 조준, 떼면 발사", body: "두 팔을 어깨 높이로 활짝 벌리면 시위 잡기(더 벌릴수록 당김), 앞손으로 조준, 두 손을 모으거나 당긴 손을 내리면 발사" },
  swim: { key: [["젓기", "F · J 번갈아"], ["숨쉬기", "잠깐 멈추기 (숨 게이지가 빨개지면)"]], hand: "손바닥을 보이고 원 그리기(반 바퀴 = 한 번), 멈추면 숨", body: "자유형처럼 두 팔을 번갈아 머리 위로 돌리기, 멈추면 숨" },
  tug: { key: [["당기기", "F · J · Space 연타"]], hand: "주먹을 꽉 쥐었다 펴기를 빠르게 반복", body: "두 손을 머리 위로 뻗었다가 가슴 아래로 끌어내리기 반복" },
  orch: { key: [["크기", "마우스 위아래 (↑ · ↓)"], ["빠르기", "마우스를 빠르게 흔들기 (Space를 박자에 맞춰)"]], hand: "손을 올리면 크게, 빠르게 흔들면 빠르게", body: "팔을 높이 들면 크게, 팔을 빠르게 흔들면 빠르게" },
};
const HAND_HELP = Object.fromEntries(Object.entries(CONTROLS).map(([k, v]) => [k, v.hand]));
const BODY_HELP = Object.fromEntries(Object.entries(CONTROLS).map(([k, v]) => [k, v.body]));
const CAM_NAME = { hand: "손", body: "몸" };

const HELP_FREE = "WASD·방향키 이동 · Space 점프 · 드래그로 시점 · 바닥 클릭으로 이동 · 종목 표식에 다가가 E";

/**
 * 전체화면 월드. host가 만든 말(편집 버전)을 넣고, 구역에 다가가 종목을 시작한다.
 * host: { getModel(), makeGeometry(mesh), material, wireMaterial?, headingHalfExtents, edit?, onClose() }
 */
export function openWorld(host) {
  const root = document.createElement("div");
  root.className = "wf";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.innerHTML = TEMPLATE;
  document.body.append(root);
  document.body.classList.add("wf-open");
  const q = (s) => root.querySelector(s);
  const canvas = q(".wf-canvas");

  if (root.requestFullscreen) root.requestFullscreen().catch(() => {}); // 막히면 창을 꽉 채운 상태로 둔다

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);

  const world = buildScene();
  const { scene } = world;
  const hud = createHud(root);
  const input = createInput(canvas);
  // 종목 소개 카드: 키보드로 / 손으로(손가락 인식) / 몸으로(몸 인식) 시작 버튼을 따로 둔다
  const introOrig = hud.intro;
  hud.intro = (o) => {
    const id = active?.id;
    const hint = id && HAND_HELP[id];
    const r = introOrig({ ...o, howto: [...o.howto, ...(hint ? [["손으로 할 때", hint], ["몸으로 할 때", BODY_HELP[id]]] : [])] });
    if (!hint) return r;
    const go = r.el.querySelector("[data-go]");
    go.innerHTML = `키보드로 플레이하기 <small>키보드·마우스</small> <kbd>Enter</kbd>`;
    go.classList.add("wf-play");
    // 키보드로 고르면 켜져 있던 카메라는 끈다
    go.addEventListener("click", () => hands.state !== "off" && hands.disable(), { capture: true });
    const note = document.createElement("p");
    note.className = "wf-camnote";
    note.textContent = "카메라 영상은 이 브라우저 안에서만 처리하고 저장·전송하지 않아요. 처음 한 번 인식 모델을 내려받아요.";
    go.parentElement.after(note);
    const buttons = [];
    const makeCam = (k, label, sub, cls) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `primary wf-play ${cls}`;
      const idle = () => (btn.innerHTML = `${label} <small>${hands.active && hands.kind === k ? "카메라 켜짐" : sub}</small>`);
      idle();
      go.before(btn);
      buttons.push(btn);
      btn.addEventListener("click", async () => {
        if (!(hands.active && hands.kind === k)) {
          [go, ...buttons].forEach((x) => (x.disabled = true));
          btn.innerHTML = "카메라 준비 중… <small>브라우저가 물으면 '허용'</small>";
          await hands.enable(k);
          [go, ...buttons].forEach((x) => (x.disabled = false));
          if (!(hands.active && hands.kind === k)) {
            idle();
            note.textContent = hands.status.error || "카메라를 켜지 못했어요.";
            note.classList.add("err");
            return;
          }
        }
        hands.setMode(id);
        r.go();
      });
    };
    makeCam("hand", "손으로 플레이하기", "손가락 인식", "wf-play-cam");
    makeCam("body", "몸으로 플레이하기", "몸 인식 · 캐릭터가 따라 해요", "wf-play-body");
    return r;
  };
  const handBtn = () => q('[data-act="hand"]');
  const hands = createHands({
    input,
    container: q(".wf-rcol"),
    onChange: ({ state, error }) => {
      const b = handBtn();
      b.textContent = state === "on" ? `카메라: ${CAM_NAME[hands.kind]}` : state === "loading" ? "카메라: 준비 중…" : "카메라: 꺼짐";
      b.setAttribute("aria-pressed", String(state === "on"));
      if (state === "on") {
        hands.setMode(active ? active.id : "free");
        hud.toast(hands.kind === "body" ? "몸 인식을 켰어요. 캐릭터가 내 팔다리를 따라 해요 (키보드도 그대로 써요)" : "손 인식을 켰어요. 종목마다 조작이 달라요 (키보드도 그대로 써요)", 2800);
      }
      if (error) hud.toast(error, 8000);
      renderControls();
    },
  });
  const ctlBox = q(".wf-ctl");
  function renderControls() {
    const id = active?.id;
    ctlBox.hidden = !id;
    if (!id) return;
    const c = CONTROLS[id];
    const on = (k) => hands.active && hands.kind === k;
    const row = (k, label, text) => `<dt class="hand${on(k) ? " on" : ""}">${label}</dt><dd class="hand${on(k) ? " on" : ""}">${hud.esc(text)}</dd>`;
    ctlBox.querySelector("dl").innerHTML =
      c.key.map(([k, v]) => `<dt>${hud.esc(k)}</dt><dd>${hud.esc(v)}</dd>`).join("") +
      row("hand", "손으로", c.hand) +
      row("body", "몸으로", c.body) +
      `<dt>그만하기</dt><dd>종목 나가기 · 결과에서 Enter = 다시</dd>`;
  }
  function askHands() {
    const el = document.createElement("div");
    el.className = "wf-overlay";
    el.innerHTML = `<div class="wf-card"><h2>카메라로 조작하기</h2>
      <p class="wf-lede">웹캠으로 손가락이나 몸 동작을 읽어 조작해요. 몸 인식이면 관절을 찍은 캐릭터가 내 팔다리를 따라 해요.</p>
      <dl class="wf-howto"><dt>카메라</dt><dd>이 컴퓨터의 브라우저 안에서만 처리하고, 영상은 저장하거나 전송하지 않아요</dd><dt>준비</dt><dd>인식 모델을 처음 한 번 인터넷에서 내려받아요</dd><dt>끄기</dt><dd>언제든 위쪽 '카메라' 버튼으로 꺼요</dd></dl>
      <div class="wf-row"><button class="ghost" data-x>취소</button><button class="primary wf-play-cam" data-k="hand">손 인식 켜기</button><button class="primary wf-play-body" data-k="body">몸 인식 켜기</button></div></div>`;
    root.append(el);
    el.querySelector("[data-x]").addEventListener("click", () => el.remove());
    el.querySelectorAll("[data-k]").forEach((b) =>
      b.addEventListener("click", () => {
        el.remove();
        hands.enable(b.dataset.k);
      }),
    );
    el.querySelector("[data-k]").focus();
  }
  const raycaster = new THREE.Raycaster();

  // ── 말 ──
  const material = host.material.clone();
  let player = null;
  const buildPlayer = () => {
    const m = host.getModel();
    return createPlayer({
      geometry: host.makeGeometry(m.mesh),
      material,
      wireMaterial: host.wireMaterial,
      collider: m.collider,
      theta: m.theta,
      headingHalfExtents: host.headingHalfExtents,
      obstacles: world.obstacles,
      rig: m.rig || null,
    });
  };
  player = buildPlayer();
  scene.add(player.root);
  player.spawn(SPAWN[0], SPAWN[1]);

  function refreshModel() {
    const old = player;
    scene.remove(old.root);
    old.dispose();
    player = buildPlayer();
    player.pos.copy(old.pos);
    player.pos.y += 0.6;
    player.yaw = old.yaw;
    scene.add(player.root);
  }

  // ── 카메라 ──
  const rig = { yaw: 0.49, pitch: 0.38, dist: 8, look: new THREE.Vector3(0, 0.6, 0), shot: null, shotLook: new THREE.Vector3(), focus: new THREE.Vector3() };
  const tmp = new THREE.Vector3();
  function placeCamera(dt, snap = false) {
    const k = snap ? 1 : 1 - Math.exp(-dt * 6);
    if (rig.shot) {
      camera.position.lerp(tmp.copy(rig.shot.pos), 1 - Math.exp(-dt * (rig.shot.rate ?? 4)));
      rig.look.lerp(rig.shot.look, 1 - Math.exp(-dt * (rig.shot.rate ?? 4)));
    } else {
      const f = new THREE.Vector3(player.pos.x, player.pos.y + player.height * 0.5, player.pos.z);
      const c = Math.cos(rig.pitch);
      const want = new THREE.Vector3(f.x + Math.sin(rig.yaw) * c * rig.dist, f.y + Math.sin(rig.pitch) * rig.dist, f.z + Math.cos(rig.yaw) * c * rig.dist);
      camera.position.lerp(want, snap ? 1 : 1 - Math.exp(-dt * 8));
      rig.look.lerp(f, k);
    }
    camera.lookAt(rig.look);
  }
  placeCamera(0, true);
  camera.position.set(player.pos.x + 3.5, 4, player.pos.z + 6.5);

  // ── 크기 ──
  function resize() {
    const w = root.clientWidth || innerWidth;
    const h = root.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  resize();

  // ── 종목 목록·안내 ──
  const zoneList = q(".wf-zones ul");
  const zoneRows = ZONES.map((z) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="wf-zname"></span><em></em><button class="ghost" type="button">이동</button>`;
    li.querySelector(".wf-zname").textContent = z.name;
    li.querySelector("button").addEventListener("click", () => teleport(z));
    zoneList.append(li);
    return { z, dist: li.querySelector("em") };
  });
  function teleport(z) {
    if (active) return;
    player.pos.set(z.pad[0] + 1.2, 0.3, z.pad[1]);
    player.vel.set(0, 0, 0);
    player.target = null;
    player.yaw = -Math.PI / 2;
  }

  const prompt = q(".wf-prompt");
  const promptBtn = prompt.querySelector("button");
  let nearZone = null;
  promptBtn.addEventListener("click", () => nearZone && startEvent(nearZone.id));

  // ── 보석 ──
  let score = 0;
  const gemsEl = q(".wf-gems");
  const showScore = () => (gemsEl.textContent = `보석 ${score} / ${world.gems.length}`);
  showScore();

  // ── 종목 ──
  let active = null;
  const horses = [];
  const ctx = {
    THREE,
    scene,
    camera,
    renderer,
    hud,
    input,
    layout,
    sfx,
    world,
    get player() {
      return player;
    },
    material,
    best: bestOf,
    bestText,
    submit: submitRecord,
    recordLabel: (id, v) => RECORD_RULES[id].label(v),
    /** CPU 선수용 말 복제본 */
    makeHorse(tint) {
      const h = cloneHorse(player, material, tint);
      scene.add(h.root);
      horses.push(h);
      return h;
    },
    removeHorse(h) {
      scene.remove(h.root);
      h.dispose();
      const i = horses.indexOf(h);
      if (i >= 0) horses.splice(i, 1);
    },
    shot(pos, look, rate = 4) {
      rig.shot = { pos: new THREE.Vector3(...pos), look: new THREE.Vector3(...look), rate };
    },
    snapShot() {
      if (rig.shot) {
        camera.position.copy(rig.shot.pos);
        rig.look.copy(rig.shot.look);
        camera.lookAt(rig.look);
      }
    },
    freeCamera() {
      rig.shot = null;
    },
    /** 그림자·조명이 따라갈 지점 */
    focus(x, y, z) {
      rig.focus.set(x, y, z);
    },
    exit,
  };

  function startEvent(id) {
    if (active || !EVENTS[id]) return;
    sfx.resume();
    closeDrawer();
    q('[data-act="edit"]').disabled = true;
    prompt.hidden = true;
    player.target = null;
    world.marker.visible = false;
    player.physics = false;
    root.classList.add("wf-in-event");
    world.pads.forEach((p) => (p.ring.visible = p.label.visible = false));
    const mod = EVENTS[id].create(ctx);
    active = { id, mod };
    hands.setMode(id);
    renderControls();
    q(".wf-help").textContent = "";
    hud.box(`<button class="ghost" data-act="evexit">종목 나가기</button>`, "tr").querySelector("button").addEventListener("click", exit);
    mod.enter();
  }

  function exit() {
    if (!active) return;
    const { id, mod } = active;
    active = null;
    root.classList.remove("wf-in-event");
    world.pads.forEach((p) => (p.ring.visible = p.label.visible = true));
    try {
      mod.exit?.();
    } finally {
      hands.setMode("free");
      renderControls();
      horses.splice(0).forEach((h) => {
        scene.remove(h.root);
        h.dispose();
      });
      hud.clear();
      const z = ZONES.find((x) => x.id === id);
      rig.shot = null;
      player.physics = true;
      player.pose = null;
      player.tilt.rotation.set(0, 0, 0);
      player.pos.set(z.pad[0] + 1.6, 0.4, z.pad[1]);
      player.vel.set(0, 0, 0);
      player.yaw = -Math.PI / 2;
      player.target = null;
      q('[data-act="edit"]').disabled = !host.edit;
      q(".wf-help").textContent = HELP_FREE;
      rig.yaw = 0.49;
      rig.pitch = 0.38;
    }
  }

  // ── 자유 이동 ──
  const KEYDIR = { KeyW: "f", ArrowUp: "f", KeyS: "b", ArrowDown: "b", KeyA: "l", ArrowLeft: "l", KeyD: "r", ArrowRight: "r" };
  function freeStep(dt) {
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const dir = new THREE.Vector3();
    let keyed = false;
    for (const [code, d] of Object.entries(KEYDIR)) {
      if (!input.isHeld(code)) continue;
      keyed = true;
      if (d === "f") dir.add(fwd);
      if (d === "b") dir.sub(fwd);
      if (d === "r") dir.add(right);
      if (d === "l") dir.sub(right);
    }
    if (keyed) {
      player.target = null;
      world.marker.visible = false;
    } else if (player.target) {
      dir.set(player.target.x - player.pos.x, 0, player.target.z - player.pos.z);
      if (dir.length() < 0.15) {
        player.target = null;
        world.marker.visible = false;
        dir.set(0, 0, 0);
      }
    }
    player.step(dt, dir);

    for (const g of world.gems) {
      if (!g.visible) continue;
      const dxz = Math.hypot(g.position.x - player.pos.x, g.position.z - player.pos.z);
      const dy = g.position.y - (player.pos.y + player.height / 2);
      if (dxz < Math.max(...player.half) + 0.35 && Math.abs(dy) < player.height / 2 + 0.45) {
        g.visible = false;
        score++;
        showScore();
        if (score === world.gems.length) {
          hud.toast("보석을 모두 모았어요!");
          setTimeout(() => {
            score = 0;
            world.gems.forEach((x) => (x.visible = true));
            showScore();
          }, 2500);
        }
      }
    }

    // 가까운 종목 안내
    let best = null;
    let bd = Infinity;
    for (const z of ZONES) {
      const d = Math.hypot(z.pad[0] - player.pos.x, z.pad[1] - player.pos.z);
      if (d < z.r && d < bd) {
        best = z;
        bd = d;
      }
    }
    if (best !== nearZone) {
      nearZone = best;
      prompt.hidden = !best;
      if (best) promptBtn.innerHTML = `<kbd>E</kbd> ${hud.esc(best.name)} 시작 <small>${hud.esc(bestText(best.id))}</small>`;
    }
  }

  // ── 입력 연결 ──
  const offKey = input.on("key", ({ code }) => {
    if (active) {
      if (code === "KeyH") ctlBox.open = !ctlBox.open;
      if (code === "Enter") root.querySelector(".wf-overlay [data-go], .wf-overlay [data-again]")?.click();
      return;
    }
    if ((code === "KeyE" || code === "Enter") && nearZone) startEvent(nearZone.id);
  });
  const offJump = input.on("jump", () => {
    if (!active) player.jump();
  });

  // 시점 회전(드래그)·클릭 이동
  let drag = null;
  const offDown = input.on("down", (p) => {
    if (active) return;
    drag = { x: p.cx, y: p.cy, t: performance.now(), moved: 0 };
  });
  const offMove = input.on("move", (p) => {
    if (!drag || !input.pointer.down) return;
    const dx = p.cx - drag.x;
    const dy = p.cy - drag.y;
    drag.x = p.cx;
    drag.y = p.cy;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    rig.yaw -= dx * 0.006;
    rig.pitch = THREE.MathUtils.clamp(rig.pitch + dy * 0.005, 0.08, 1.3);
  });
  const offUp = input.on("up", (p) => {
    if (!drag || active) return (drag = null);
    const quick = performance.now() - drag.t < 400;
    const moved = drag.moved;
    drag = null;
    if (moved > 8 || !quick) return;
    raycaster.setFromCamera(new THREE.Vector2(p.x * 2 - 1, -(p.y * 2 - 1)), camera);
    const hit = raycaster.intersectObject(world.ground, false)[0];
    if (!hit) return;
    player.target = new THREE.Vector3(THREE.MathUtils.clamp(hit.point.x, BOUNDS.minX, BOUNDS.maxX), 0, THREE.MathUtils.clamp(hit.point.z, BOUNDS.minZ, BOUNDS.maxZ));
    world.marker.position.set(player.target.x, 0.03, player.target.z);
    world.marker.visible = true;
  });
  const onWheel = (e) => {
    if (active) return;
    e.preventDefault();
    rig.dist = THREE.MathUtils.clamp(rig.dist * (1 + Math.sign(e.deltaY) * 0.1), 3, 22);
  };
  canvas.addEventListener("wheel", onWheel, { passive: false });

  // ── 말 모양 고치기 서랍 ──
  const drawer = q(".wf-drawer");
  const chat = q(".wf-chat");
  function openDrawer() {
    if (!host.edit || active) return;
    drawer.hidden = false;
    drawer.querySelector("input").focus();
  }
  function closeDrawer() {
    drawer.hidden = true;
  }
  function say(text, tone = "", suggested = null) {
    const m = document.createElement("div");
    m.className = `wf-msg ${tone}`;
    m.textContent = text;
    if (suggested) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = `"${suggested}"로 고쳐 쓰기`;
      b.addEventListener("click", () => {
        drawer.querySelector("input").value = suggested;
        drawer.querySelector("input").focus();
      });
      m.append(b);
    }
    chat.append(m);
    chat.scrollTop = chat.scrollHeight;
  }
  if (host.edit) {
    for (const p of host.edit.quick) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = p;
      b.addEventListener("click", () => host.edit.send(p));
      q(".wf-chips").append(b);
    }
    q(".wf-dform").addEventListener("submit", async (e) => {
      e.preventDefault();
      const inp = e.target.querySelector("input");
      const text = inp.value.trim();
      if (!text) return;
      inp.value = "";
      await host.edit.send(text);
    });
    say("지금 월드의 말 모양을 말로 고칠 수 있어요. 예: 세워줘, 더 두껍게");
  } else {
    q('[data-act="edit"]').disabled = true;
  }

  // ── 버튼 ──
  root.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "close") close();
    else if (act === "full") toggleFull();
    else if (act === "edit") (drawer.hidden ? openDrawer() : closeDrawer());
    else if (act === "dclose") closeDrawer();
    else if (act === "undo") host.edit?.undo();
    else if (act === "hand") (hands.state === "off" ? askHands() : hands.disable());
  });
  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else root.requestFullscreen?.().catch(() => hud.toast("전체화면을 켤 수 없어요. 창 안에서 그대로 즐길 수 있어요."));
  }
  const onFs = () => {
    q('[data-act="full"]').textContent = document.fullscreenElement ? "전체화면 해제" : "전체화면";
  };
  document.addEventListener("fullscreenchange", onFs);

  // ── 루프 ──
  let raf = 0;
  let last = performance.now();
  let t = 0;
  let closed = false;
  function frame(now) {
    if (closed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    world.update(t);
    if (active) {
      active.mod.update(dt);
    } else {
      freeStep(dt);
      rig.focus.set(player.pos.x, player.pos.y, player.pos.z);
      // 가까운 종목까지 거리
      if (Math.floor(t * 4) !== Math.floor((t - dt) * 4)) {
        for (const r of zoneRows) r.dist.textContent = `${Math.round(Math.hypot(r.z.pad[0] - player.pos.x, r.z.pad[1] - player.pos.z))}m`;
      }
    }
    player.puppet = hands.puppet;
    player.render(dt);
    for (const h of horses) h.root.updateMatrixWorld();
    world.sun.position.set(rig.focus.x + 4, rig.focus.y + 12, rig.focus.z + 6);
    world.sun.target.position.copy(rig.focus);
    placeCamera(dt);
    renderer.render(scene, camera);
  }
  q(".wf-help").textContent = HELP_FREE;
  raf = requestAnimationFrame(frame);

  function close() {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    if (active) {
      try {
        active.mod.exit?.();
      } catch {
        /* 닫는 중이므로 무시 */
      }
      active = null;
    }
    [offKey, offJump, offDown, offMove, offUp].forEach((f) => f());
    hands.dispose();
    input.dispose();
    canvas.removeEventListener("wheel", onWheel);
    document.removeEventListener("fullscreenchange", onFs);
    ro.disconnect();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    horses.splice(0).forEach((h) => h.dispose());
    world.dispose();
    player.dispose();
    material.dispose();
    renderer.dispose();
    root.remove();
    document.body.classList.remove("wf-open");
    host.onClose?.();
  }

  return {
    close,
    refreshModel,
    say,
    get active() {
      return active?.id ?? null;
    },
    startEvent, // 테스트·바로가기용
    teleport: (id) => teleport(ZONES.find((z) => z.id === id)),
    state: () => ({ player, camera, active: active?.id ?? null, score }),
  };
}
