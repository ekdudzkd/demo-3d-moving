// 100m 달리기: F·J를 번갈아 눌러 달린다. 규칙은 logic/run.js, 여기는 화면·입력·연출.
import { TICK, FINISH, newRace, simTick, rankings, isValidRun, maxCadence, MAX_HUMAN_CADENCE, FALL_SEC, GETUP_SEC } from "../logic/run.js";

export const info = {
  id: "run",
  name: "100m 달리기",
  lede: "왼쪽·오른쪽 발을 번갈아 눌러 100m를 가장 빨리 달리세요.",
  howto: [
    ["달리기", "F · J 번갈아 누르기 (← · → 도 가능)"],
    ["박자", "일정한 박자로, 같은 쪽을 연달아 누르면 비틀거려요"],
    ["넘어짐", "균형 게이지가 가득 차면 넘어져요. 잠깐 쉬면 회복돼요"],
  ],
};

export function create(ctx) {
  const { THREE, hud, input, layout, sfx } = ctx;
  const { TRACK } = layout;
  const off = [];
  let race = null;
  let horses = [];
  let state = "idle"; // idle | count | run | done
  let acc = 0;
  let stopCount = null;
  let pending = [];
  let hudEls = null;
  let tapeOrig = null;
  let finishedShown = false;

  const laneZ = (r) => TRACK.laneZ(r.lane);
  const posX = (r) => TRACK.startX + r.x;

  function poseOf(r, t) {
    if (r.state === "fall") {
      const k = Math.min(1, r.fallT / 0.25);
      const rec = r.fallT > FALL_SEC - 0.4 ? (r.fallT - (FALL_SEC - 0.4)) / 0.4 : 0;
      return { roll: (1 - rec) * 1.45 * k, lift: 0, bob: 0, scaleY: 1 };
    }
    if (r.state === "getup") {
      const k = r.gT / GETUP_SEC;
      return { roll: (1 - k) * 0.5, bob: Math.sin(k * Math.PI) * 0.12, lean: 0 };
    }
    const sp = Math.min(1, r.v / 11.5);
    const gait = { kind: "run", ph: r.phase, amp: Math.min(1, r.v / 7) };
    // 관절이 있으면 팔다리가 달리므로 몸 전체 흔들기는 약하게
    if (ctx.player.skinned) return { bob: Math.abs(Math.sin(r.phase)) * 0.05 * sp, lean: -0.05 - 0.08 * sp, roll: 0, gait };
    return {
      bob: Math.abs(Math.sin(r.phase)) * 0.16 * sp,
      lean: -0.1 - 0.18 * sp,
      roll: Math.sin(r.phase) * 0.06 * sp,
      gait,
    };
  }

  function placeAll(dt) {
    race.racers.forEach((r, i) => {
      const p = poseOf(r);
      if (r.isPlayer) {
        ctx.player.setPose({ x: posX(r), y: 0, z: laneZ(r), yaw: 0, ...p });
        ctx.player.render(dt);
      } else {
        horses[i - 1].render(posX(r), 0, laneZ(r), 0, p);
      }
    });
  }

  function setup() {
    race = newRace((Math.random() * 1e9) | 0, "나");
    race.onEvent = (type, r) => {
      if (type === "fall" && r.isPlayer) {
        sfx.thud();
        hud.toast("앗, 넘어졌어요!");
      } else if (type === "fall") hud.toast(`${r.name}가 넘어졌어요`);
      if (type === "finish" && r.isPlayer) {
        sfx.win();
        if (state === "run") finish();
      }
    };
    horses.forEach((h) => ctx.removeHorse(h));
    horses = race.racers.slice(1).map((r) => ctx.makeHorse(r.color));
    pending = [];
    acc = 0;
    finishedShown = false;
    state = "idle";
    if (tapeOrig) ctx.world.venue.tape.visible = true;
    hud.clear();
    const stats = {
      time: hud.stat("시간", "0.00"),
      dist: hud.stat("거리", "0m"),
      speed: hud.stat("속도", "0.0m/s"),
      rank: hud.stat("순위", "1/4"),
    };
    const bal = hud.meter("균형");
    const wrap = hud.box("", "tl", "wf-stats");
    for (const s of Object.values(stats)) wrap.append(s.el);
    const bw = hud.box("", "bl");
    bw.append(bal.el);
    bal.set(0);
    hudEls = { stats, bal };
    hud.box(`<button class="ghost" data-act="evexit">종목 나가기</button>`, "tr").querySelector("button").addEventListener("click", ctx.exit);
    placeAll(0);
    cam(true);
  }

  function cam(snap) {
    const P = race.racers[0];
    const x = posX(P);
    const z = laneZ(P);
    ctx.shot([x - 8.5, 3.3, z + 7.5], [x + 6, 0.9, z - 2.2], snap ? 20 : 5);
    if (snap) ctx.snapShot();
  }

  function begin() {
    hud.clear();
    setup();
    state = "count";
    stopCount = hud.countdown(() => (state = "run"), { beep: sfx.beep, go: sfx.go });
  }

  function onStep({ side }) {
    if (state !== "run") return;
    pending.push(side);
    sfx.step();
  }

  function finish() {
    if (finishedShown) return;
    finishedShown = true;
    ctx.world.venue.tape.visible = false;
    setTimeout(showResult, 1400);
  }

  function showResult() {
    if (state === "idle") return;
    state = "done";
    const P = race.racers[0];
    const ranks = rankings(race);
    const place = ranks.indexOf(P) + 1;
    let record = null;
    let note = null;
    if (P.finishTime === null) note = "결승선을 넘지 못했어요.";
    else if (!isValidRun(P)) note = `1초에 ${maxCadence(P.stepTicks)}걸음은 사람이 누르기 어려워요 (최대 ${MAX_HUMAN_CADENCE}). 기록은 저장하지 않았어요.`;
    else if (ctx.submit("run", P.finishTime)) record = "새 최고 기록!";
    const fmt = (r) => (r.finishTime === null ? "미완주" : `${r.finishTime.toFixed(2)}초`);
    hud.result({
      title: `${place}위`,
      record,
      note,
      rows: [
        ...ranks.map((r, i) => [`${i + 1}. ${r.isPlayer ? "나" : r.name}`, fmt(r)]),
        ["걸음 수", `${P.steps}걸음`],
        ["넘어진 횟수", `${P.falls}번`],
      ],
      onAgain: begin,
      onExit: ctx.exit,
    });
  }

  function showIntro() {
    hud.clear();
    hud.box(`<button class="ghost" data-act="evexit">종목 나가기</button>`, "tr").querySelector("button").addEventListener("click", ctx.exit);
    hud.intro({ title: info.name, lede: info.lede, howto: info.howto, best: ctx.bestText("run"), onStart: begin, onExit: ctx.exit, startLabel: "출발선으로" });
  }

  return {
    enter() {
      tapeOrig = true;
      ctx.player.setPose({ x: TRACK.startX, y: 0, z: TRACK.laneZ(0), yaw: 0 });
      ctx.player.render(0);
      ctx.shot([TRACK.startX - 8.5, 3.3, TRACK.laneZ(0) + 7.5], [TRACK.startX + 6, 0.9, TRACK.laneZ(0) - 2.2], 20);
      ctx.snapShot();
      off.push(input.on("step", onStep));
      off.push(
        input.on("key", ({ code }) => {
          if (code === "ArrowLeft") onStep({ side: "L" });
          if (code === "ArrowRight") onStep({ side: "R" });
        }),
      );
      showIntro();
    },
    update(dt) {
      if (!race) return;
      if (state === "run") {
        acc += Math.min(dt, 0.1);
        while (acc >= TICK) {
          simTick(race, pending);
          pending = [];
          acc -= TICK;
          if (race.tick > 60 * 90) break;
        }
        const P = race.racers[0];
        const ranks = rankings(race);
        const s = hudEls.stats;
        s.time.set(((P.finishTime ?? race.tick * TICK)).toFixed(2));
        s.dist.set(`${Math.min(FINISH, P.x).toFixed(0)}m`);
        s.speed.set(`${P.v.toFixed(1)}m/s`);
        s.rank.set(`${ranks.indexOf(P) + 1}/4`);
        hudEls.bal.set(P.b, "", P.b > 0.65);
        if (P.finishTime === null && race.tick >= 60 * 60) {
          // 60초가 지나도 못 들어오면 종료
          showResult();
        }
        if (race.racers.every((r) => r.finishTime !== null) && !finishedShown) finish();
      }
      if (state === "run" || state === "count" || state === "done") placeAll(dt);
      if (state !== "idle") cam(false);
    },
    exit() {
      off.splice(0).forEach((f) => f());
      stopCount?.();
      horses.forEach((h) => ctx.removeHorse(h));
      horses = [];
      ctx.world.venue.tape.visible = true;
      ctx.freeCamera();
    },
  };
}
