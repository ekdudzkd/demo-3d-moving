// 높이뛰기: F·J로 도움닫기, 바 앞 적정 구간에서 Space로 점프. 규칙은 logic/hj.js.
import { TICK } from "../logic/run.js";
import { BAR_X, HIP0, START_BAR, MAX_FAILS, BEST_WINDOW, OK_WINDOW, groundAt, newAttempt, pressStep, pressJump, tick, landingDone, decide, nextBarHeight, CPU_BEST } from "../logic/hj.js";
import { clamp, ease, lerp } from "../logic/rng.js";

export const info = {
  id: "hj",
  name: "높이뛰기",
  lede: "달려와서 바를 넘으세요. 성공하면 바가 10cm씩 올라가고, 같은 높이를 3번 실패하면 끝나요.",
  howto: [
    ["도움닫기", "F · J 번갈아 누르기 (← · → 도 가능)"],
    ["점프", "Space — 바 앞 초록 구간에서"],
    ["높이", "빨리 달릴수록, 바 앞 2m 근처에서 뛸수록 높이 떠요"],
  ],
};

export function create(ctx) {
  const { hud, input, layout, sfx } = ctx;
  const { HJ } = layout;
  const off = [];
  const X0 = HJ.runwayX0;
  const wx = (rel) => X0 + rel;
  let st = null; // { barH, fails, best, jumps, sheet }
  let a = null;
  let acc = 0;
  let phase = "idle"; // idle | play | result | end
  let resT = 0;
  let barT = 0;
  let els = null;
  let sheetSig = "";

  const bar = () => ctx.world.venue.bar;

  function poseFor() {
    const r = a.r;
    const p = { bob: 0, lean: 0, roll: 0, lift: 0 };
    let y = 0;
    if (a.phase === "wait") {
      p.bob = 0.03 + Math.sin(performance.now() / 380) * 0.03;
    } else if (a.phase === "approach") {
      const sp = Math.min(1, r.v / 11.5);
      p.bob = Math.abs(Math.sin(r.phase)) * 0.16 * sp;
      p.lean = -0.1 - 0.18 * sp;
      p.roll = Math.sin(r.phase) * 0.06 * sp;
      if (r.state === "fall") {
        const k = Math.min(1, r.fallT / 0.25);
        p.roll = 1.45 * k;
        p.lean = 0;
        p.bob = 0;
      }
    } else if (a.phase === "flight") {
      const F = a.flight;
      const prog = clamp((F.x - F.x0) / (F.d + 1.4), 0, 1);
      const past = F.x - BAR_X;
      p.lean = 0.7 * ease(clamp(prog * 1.4, 0, 1)) - 1.5 * ease(clamp((past + 0.2) / 1.2, 0, 1));
      p.roll = 0.5 * Math.sin(prog * Math.PI);
      y = Math.max(a.hipY - HIP0, groundAt(F.x));
    } else if (a.phase === "landing") {
      const k = Math.min(1, a.landT / 0.3);
      p.roll = (a.reason ? 1.45 : 0.9) * k * (1 - clamp((a.landT - 0.9) / 0.4, 0, 1));
      p.lean = 0;
      y = a.flight ? groundAt(a.flight.x) : groundAt(r.x);
    }
    return { y, pose: p };
  }

  function place(dt) {
    const { y, pose } = poseFor();
    const x = a.flight && (a.phase === "flight" || a.phase === "landing") ? a.flight.x : a.r.x;
    ctx.player.setPose({ x: wx(x), y, z: HJ.z, yaw: 0, ...pose });
    ctx.player.render(dt);
    // 바
    const b = bar();
    if (a.barDown) {
      barT += dt;
      const u = ease(clamp(barT / 0.45, 0, 1));
      b.position.set(BAR_X + X0 + 0.7 * u, lerp(a.barH, 0.55, u), HJ.z);
    } else b.position.set(BAR_X + X0, a.barH, HJ.z);
  }

  function camera(snap) {
    const x = a.flight && a.phase !== "approach" ? a.flight.x : a.r.x;
    if (["flight", "landing"].includes(a.phase) || phase === "result" || phase === "end") {
      ctx.shot([X0 + BAR_X - 4.2, 2.6, HJ.z + 6.4], [X0 + BAR_X + 0.4, 1.4, HJ.z - 0.2], 4);
    } else {
      const tx = clamp(x, BAR_X - 22, BAR_X - 2.5);
      ctx.shot([X0 + tx - 0.8, 2.4, HJ.z + 8.6], [X0 + tx + 4, 1.2, HJ.z - 1], 5);
    }
    if (snap) ctx.snapShot();
  }

  function msg(text, ms = 0) {
    els.msg.textContent = text;
    els.msg.hidden = !text;
    clearTimeout(msg.t);
    if (ms) msg.t = setTimeout(() => (els.msg.hidden = true), ms * 1000);
  }

  function build() {
    hud.clear();
    const wrap = hud.box("", "tl", "wf-stats");
    els = {
      bar: hud.stat("바 높이", "-"),
      spd: hud.stat("속도", "0km/h"),
      best: hud.stat("최고", "-"),
    };
    for (const s of [els.bar, els.spd, els.best]) wrap.append(s.el);
    els.sheet = hud.box("", "br", "wf-sheet");
    const mb = hud.box(`<div class="wf-hjmeter"><i class="ok"></i><i class="best"></i><b class="dot"></b></div><div class="wf-hjnow"></div>`, "bl", "wf-hjbox");
    els.meter = mb;
    els.dot = mb.querySelector(".dot");
    els.now = mb.querySelector(".wf-hjnow");
    els.msg = hud.box("", "tc", "wf-msg-line");
    els.msg.hidden = true;
    hud.box(`<button class="ghost" data-act="evexit">종목 나가기</button>`, "tr").querySelector("button").addEventListener("click", ctx.exit);
    sheetSig = "";
  }

  function newTry() {
    a = newAttempt(st.barH);
    a.onTakeoff = () => {
      st.jumps++;
      sfx.beep(660, 0.08);
    };
    a.onKnock = () => sfx.hit?.();
    barT = 0;
    acc = 0;
    resT = 0;
    phase = "play";
    const row = st.sheet[st.sheet.length - 1];
    msg(`${st.barH.toFixed(2)}m · ${row.m.length + 1}차 시기 — F · J로 달리면 시작해요`);
    camera(true);
    place(0);
  }

  function begin() {
    st = { barH: START_BAR, fails: 0, best: 0, jumps: 0, sheet: [{ h: START_BAR, m: "" }] };
    build();
    newTry();
  }

  function judge() {
    const d = decide(a);
    const row = st.sheet[st.sheet.length - 1];
    row.m += d.ok ? "O" : "X";
    let why;
    if (d.ok) {
      st.best = st.barH;
      st.fails = 0;
      sfx.win();
      hud.toast("성공!");
      st.barH = nextBarHeight(st.barH);
      st.sheet.push({ h: st.barH, m: "" });
      why = `${d.why} 다음 높이 ${st.barH.toFixed(2)}m`;
    } else {
      st.fails++;
      sfx.lose();
      hud.toast("실패");
      why = `${d.why} · ${st.fails >= MAX_FAILS ? "3번 실패로 경기 끝" : `이 높이 남은 기회 ${MAX_FAILS - st.fails}번`}`;
    }
    msg(why, 2.2);
    phase = "result";
    resT = 0;
  }

  function end() {
    phase = "end";
    const best = st.best;
    const field = [{ name: "나", h: best, me: true }, ...CPU_BEST].sort((x, y) => y.h - x.h);
    const rank = field.findIndex((f) => f.me) + 1;
    let record = null;
    if (best > 0 && ctx.submit("hj", best)) record = "새 최고 기록!";
    hud.result({
      title: `${rank}위`,
      record,
      rows: [
        ...field.map((f, i) => [`${i + 1}. ${f.me ? "나" : f.name}`, f.h ? `${f.h.toFixed(2)}m` : "기록 없음"]),
        ["점프 횟수", `${st.jumps}번`],
        ["기록지", st.sheet.filter((s) => s.m).map((s) => `${s.h.toFixed(2)} ${s.m}`).join(" · ") || "-"],
      ],
      note: "도움닫기가 빠를수록, 바 앞 2m에 가까이서 뛸수록 높이 떠요.",
      onAgain: begin,
      onExit: ctx.exit,
    });
    camera(false);
  }

  function updateHud() {
    const r = a.r;
    els.bar.set(`${st.barH.toFixed(2)}m`);
    els.spd.set(`${(r.v * 3.6).toFixed(0)}km/h`);
    els.best.set(st.best ? `${st.best.toFixed(2)}m` : "-");
    const inApp = a.phase === "approach" || a.phase === "wait";
    els.meter.hidden = !inApp;
    if (inApp) {
      const dist = BAR_X - r.x;
      els.dot.style.left = `${clamp(100 - (dist / 12) * 100, 0, 100)}%`;
      const zone = dist <= BEST_WINDOW[1] && dist >= BEST_WINDOW[0] ? "best" : dist <= OK_WINDOW[1] && dist >= OK_WINDOW[0] ? "ok" : "";
      els.meter.dataset.zone = zone;
      els.now.textContent = zone === "best" ? "지금 뛰어요! (Space)" : zone === "ok" ? "뛸 수 있어요" : `바까지 ${Math.max(0, dist).toFixed(1)}m`;
    }
    const sig = st.sheet.map((s) => s.h + s.m).join();
    if (sig !== sheetSig) {
      sheetSig = sig;
      const rows = st.sheet.slice(-6);
      els.sheet.innerHTML = `<small>기록지 · O 성공 X 실패</small>${rows.map((s, i) => `<div class="sr${i === rows.length - 1 ? " cur" : ""}"><span>${s.h.toFixed(2)}</span><b>${(s.m + "···").slice(0, 3)}</b></div>`).join("")}`;
    }
  }

  const onStep = ({ side }) => {
    if (phase !== "play") return;
    const was = a.phase;
    pressStep(a, side);
    if (was === "wait") msg("초록 구간에서 Space로 점프!", 2);
    if (a.phase === "approach") sfx.step();
  };

  return {
    enter() {
      ctx.player.setPose({ x: X0, y: 0, z: HJ.z, yaw: 0 });
      ctx.player.render(0);
      ctx.shot([X0 + 3, 2.4, HJ.z + 8.6], [X0 + 7, 1.2, HJ.z - 1], 20);
      ctx.snapShot();
      off.push(input.on("step", onStep));
      off.push(input.on("jump", () => phase === "play" && pressJump(a, 0.5)));
      off.push(
        input.on("key", ({ code }) => {
          if (code === "ArrowLeft") onStep({ side: "L" });
          if (code === "ArrowRight") onStep({ side: "R" });
        }),
      );
      hud.clear();
      hud.box(`<button class="ghost" data-act="evexit">종목 나가기</button>`, "tr").querySelector("button").addEventListener("click", ctx.exit);
      hud.intro({ title: info.name, lede: info.lede, howto: info.howto, best: ctx.bestText("hj"), onStart: begin, onExit: ctx.exit, startLabel: "도움닫기 위치로" });
    },
    update(dt) {
      if (!a || phase === "idle") return;
      if (phase === "play" || phase === "result") {
        if (a.phase !== "wait") {
          acc += Math.min(dt, 0.1);
          let n = 0;
          while (acc >= TICK && n < 12) {
            tick(a);
            acc -= TICK;
            n++;
          }
          if (n === 12) acc = 0;
        }
        if (phase === "play" && landingDone(a)) judge();
        if (a.early !== null) {
          msg(`너무 일러요! 바 앞 ${a.early.toFixed(0)}m에서 뛰었어요. 초록일 때 뛰세요`, 1.8);
          a.early = null;
        }
        if (phase === "result") {
          resT += dt;
          if (resT > 2.2) st.fails >= MAX_FAILS ? end() : newTry();
        }
        updateHud();
      }
      place(dt);
      camera(false);
    },
    exit() {
      off.splice(0).forEach((f) => f());
      clearTimeout(msg.t);
      const b = bar();
      b.position.set(BAR_X + X0, 1.3, HJ.z);
      ctx.freeCamera();
    },
  };
}
