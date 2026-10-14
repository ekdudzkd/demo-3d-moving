// 몸 좌표(MediaPipe Pose 33점, 화면 0~1 정규화, visibility) → 월드 입력 이벤트 + 캐릭터 따라하기 자세. 순수 함수.
// 좌표는 거울처럼 뒤집어(x' = 1 - x) 쓴다: 미리보기에서 내 왼손이 화면 왼쪽에 보이는 것과 같게.
//   run·hj  제자리 뛰기(무릎 번갈아 들기) → step. 다리가 안 보이면 팔을 앞뒤(위아래)로 번갈아 흔들기 → step
//   hj      두 팔 번쩍 들기 또는 점프(골반이 훅 올라감) → jump
//   swim    자유형처럼 팔을 번갈아 머리 위로 → step(왼팔 L, 오른팔 R)
//   tug     두 손을 머리 위로 뻗었다가 가슴 아래로 끌어내리기 → step
//   arch    두 팔을 어깨 높이로 벌리면 시위 잡기, 더 벌릴수록 당김, 앞손을 움직여 조준, 두 손을 모으거나 내리면 발사 → pinch
//   orch    더 높이 든 손의 높이 = 크기, 손 빠르기 = 템포 → move
import { clamp } from "./rng.js";

export const LM = { nose: 0, sL: 11, sR: 12, eL: 13, eR: 14, wL: 15, wR: 16, hL: 23, hR: 24, kL: 25, kR: 26, aL: 27, aR: 28 };

/** 거울 좌표 + 화면비 보정(가로 = aspect배) */
export function toBody(lm, aspect = 4 / 3) {
  const P = (i) => ({ x: (1 - lm[i].x) * aspect, y: lm[i].y, v: lm[i].visibility ?? 1 });
  const b = {};
  for (const [k, i] of Object.entries(LM)) b[k] = P(i);
  // 사람 기준 왼쪽(11·13·…)이 거울 화면에서도 왼쪽에 보인다
  const vis = (p) => p.v > 0.5 && p.y > 0 && p.y < 1;
  b.sw = Math.hypot(b.sL.x - b.sR.x, b.sL.y - b.sR.y) || 0.1;
  b.shY = (b.sL.y + b.sR.y) / 2;
  b.shX = (b.sL.x + b.sR.x) / 2;
  b.hipsVis = vis(b.hL) && vis(b.hR);
  b.hipY = b.hipsVis ? (b.hL.y + b.hR.y) / 2 : b.shY + b.sw * 1.6;
  b.torso = b.hipsVis ? Math.max(0.05, b.hipY - b.shY) : b.sw * 1.6;
  b.legsVis = b.hipsVis && vis(b.kL) && vis(b.kR) && vis(b.aL) && vis(b.aR);
  b.armsVis = vis(b.wL) && vis(b.wR) && vis(b.eL) && vis(b.eR);
  return b;
}

/** 캐릭터 따라하기: 팔다리 방향(거울 화면 좌표, y 아래로). 다리가 안 보이면 legs = null */
export function puppetOf(b) {
  const d = (a, c) => [c.x - a.x, c.y - a.y];
  return {
    arms: b.armsVis ? { uaL: d(b.sL, b.eL), faL: d(b.eL, b.wL), uaR: d(b.sR, b.eR), faR: d(b.eR, b.wR) } : null,
    legs: b.legsVis ? { thL: d(b.hL, b.kL), shL: d(b.kL, b.aL), thR: d(b.hR, b.kR), shR: d(b.kR, b.aR) } : null,
  };
}

export function createBodyMapper(emit) {
  let mode = "free";
  let S = fresh();
  function fresh() {
    return { mean: 0, state: 0, hipBase: null, lastJump: 0, up: { L: false, R: false }, swimSide: null, tugUp: false, draw: null, lastLegs: null };
  }
  return {
    get mode() {
      return mode;
    },
    setMode(m) {
      mode = m;
      S = fresh();
    },
    lost() {
      if (S.draw) {
        S.draw = null;
        emit("pinch", { phase: "cancel" });
      }
      S.hipBase = null;
    },
    /** 한 프레임. lm = 33점, now = 밀리초. 반환: 쓴 신호(테스트·표시용) */
    feed(lm, now, aspect = 4 / 3) {
      const b = toBody(lm, aspect);
      if (mode === "free") return b;
      const T = b.torso;
      if (mode === "run" || mode === "hj") {
        // 다리가 보이면 무릎 높이 차, 아니면 손목 높이 차로 걸음을 센다
        const useLegs = b.legsVis;
        if (S.lastLegs !== useLegs) {
          S.mean = 0;
          S.state = 0;
          S.lastLegs = useLegs;
        }
        const f = useLegs ? (b.kR.y - b.kL.y) / T : b.armsVis ? (b.wR.y - b.wL.y) / T : 0;
        S.mean += (f - S.mean) * 0.05;
        const d = f - S.mean;
        const TH = useLegs ? 0.07 : 0.14;
        if (d > TH && S.state !== 1) {
          S.state = 1;
          emit("step", { side: "L", via: "body" });
        } else if (d < -TH && S.state !== -1) {
          S.state = -1;
          emit("step", { side: "R", via: "body" });
        }
        if (mode === "hj" && now - S.lastJump > 700) {
          // 점프: 골반이 기준보다 몸통의 15% 넘게 올라가거나, 두 손을 머리 위로 번쩍
          if (b.hipsVis) S.hipBase = S.hipBase === null ? b.hipY : S.hipBase + (b.hipY - S.hipBase) * 0.03;
          const rise = b.hipsVis && S.hipBase !== null ? (S.hipBase - b.hipY) / T : 0;
          const armsUp = b.armsVis && b.wL.y < b.nose.y && b.wR.y < b.nose.y;
          if (rise > 0.15 || (armsUp && !S.armsUp)) {
            S.lastJump = now;
            emit("jump", { via: "body", strength: clamp(rise / 0.4, 0.3, 1) });
          }
          S.armsUp = armsUp;
        }
      } else if (mode === "swim") {
        // 팔이 머리 위로 올라가는 순간마다 한 번 젓기
        for (const s of ["L", "R"]) {
          const w = b[`w${s}`];
          const up = w.v > 0.5 && w.y < b.nose.y - 0.05 * T;
          if (up && !S.up[s]) emit("step", { side: s, via: "body" });
          S.up[s] = up;
        }
      } else if (mode === "tug") {
        const wy = (b.wL.y + b.wR.y) / 2;
        if (b.armsVis && wy < b.shY - 0.1 * T) S.tugUp = true;
        else if (S.tugUp && wy > b.shY + 0.25 * T) {
          S.tugUp = false;
          emit("step", { side: "L", via: "body" });
        }
      } else if (mode === "arch") {
        if (!b.armsVis) return b;
        const dx = Math.abs(b.wL.x - b.wR.x);
        const level = Math.abs(b.wL.y - b.shY) < 0.45 * T && Math.abs(b.wR.y - b.shY) < 0.45 * T;
        // 몸 중심에서 더 먼 손 = 활 든 손(앞손)
        const front = Math.abs(b.wL.x - b.shX) > Math.abs(b.wR.x - b.shX) ? "L" : "R";
        const back = front === "L" ? "R" : "L";
        if (!S.draw) {
          if (level && dx > 1.6 * b.sw) {
            const fw = b[`w${front}`];
            S.draw = { front, x0: fw.x, y0: fw.y };
            emit("pinch", { phase: "start", via: "body" });
          }
        } else {
          const fw = b[`w${S.draw.front}`];
          const bw = b[`w${back}`];
          // 두 손을 모으거나, 당기던 손을 아래로 내리면 발사
          if (dx < 1.0 * b.sw || bw.y > b.shY + 0.6 * T) {
            S.draw = null;
            emit("pinch", { phase: "end", via: "body" });
          } else {
            emit("pinch", {
              phase: "move",
              via: "body",
              dx: ((fw.x - S.draw.x0) / T) * 0.6,
              dy: (-(fw.y - S.draw.y0) / T) * 0.6,
              pull: clamp((dx - 1.6 * b.sw) / (1.2 * b.sw), 0, 1),
            });
          }
        }
      } else if (mode === "orch") {
        const hi = b.wL.y < b.wR.y ? b.wL : b.wR;
        if (hi.v > 0.5) {
          const h = clamp((b.shY - hi.y) / (1.2 * T) + 0.4, 0, 1);
          emit("move", { x: hi.x / aspect, y: 0.9 - 0.8 * h, via: "body" });
        }
      }
      return b;
    },
  };
}
