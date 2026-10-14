// 손 좌표(MediaPipe 21점, 화면 0~1 정규화) → 월드 입력 이벤트. 화면과 카메라에 의존하지 않는 순수 변환이라 테스트할 수 있다.
// 모드는 종목 id: run | hj | arch | swim | tug | orch | free(아무것도 내지 않음)
//   run·hj   검지/중지를 번갈아 내밀기 → step(L=검지, R=중지). hj는 손을 위로 휙 올리면 jump
//   swim     손으로 원 그리기(반 바퀴마다) → step(번갈아)
//   tug      편 손 → 주먹을 쥘 때마다 step
//   arch     엄지·검지 집기 → pinch start / move(조준·당김) / end(놓기)
//   orch     손 높이 = 소리 크기, 손 빠르기 = 템포 → move {y}
import { clamp } from "./rng.js";

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function createGestureMapper(emit) {
  let mode = "free";
  let S = fresh();

  function fresh() {
    return { mean: 0, state: 0, hist: [], lastFlick: 0, pinch: false, p0: null, sw: { hist: [], prevA: null, acc: 0, side: 0 }, tug: { open: false }, side: 0 };
  }

  const api = {
    get mode() {
      return mode;
    },
    setMode(m) {
      mode = m;
      S = fresh();
    },
    /** 손이 사라졌을 때 */
    lost() {
      if (S.pinch) {
        S.pinch = false;
        emit("pinch", { phase: "cancel" });
      }
      S.hist = [];
      S.sw.hist = [];
      S.sw.prevA = null;
    },
    /** 손 한 프레임. lm = 21점 [{x,y}], now = 밀리초 */
    feed(lm, now) {
      if (!lm || mode === "free") return;
      // 손 크기(손목→중지 뿌리)와 방향: 손을 돌려도 같은 기준
      const ax = lm[9].x - lm[0].x;
      const ay = lm[9].y - lm[0].y;
      const size = Math.hypot(ax, ay) || 0.1;
      const ux = ax / size;
      const uy = ay / size;
      const palm = { x: 1 - (lm[0].x + lm[9].x) / 2, y: (lm[0].y + lm[9].y) / 2 }; // 거울처럼 뒤집은 화면 기준

      if (mode === "run" || mode === "hj") {
        const ext = (tip, mcp) => ((lm[tip].x - lm[mcp].x) * ux + (lm[tip].y - lm[mcp].y) * uy) / size;
        const f = ext(8, 5) - ext(12, 9);
        S.mean += (f - S.mean) * 0.05;
        const d = f - S.mean;
        const TH = 0.07;
        if (d > TH && S.state !== 1) {
          S.state = 1;
          emit("step", { side: "L", via: "hand" });
        } else if (d < -TH && S.state !== -1) {
          S.state = -1;
          emit("step", { side: "R", via: "hand" });
        }
        if (mode === "hj") {
          // 최근 0.35초 안에 손바닥이 손 길이의 0.5배 이상 올라가면 점프(프레임이 띄엄띄엄이어도 놓치지 않게 구간 이동 거리로 판정)
          const cy = (lm[0].y + lm[9].y) / 2;
          S.hist = S.hist.filter((h) => now - h.t < 350);
          S.hist.push({ t: now, cy });
          const low = Math.max(...S.hist.map((h) => h.cy));
          const rise = (low - cy) / size;
          if (rise > 0.5 && now - S.lastFlick > 600) {
            S.lastFlick = now;
            S.hist = [];
            emit("jump", { via: "hand", strength: clamp((rise - 0.5) / 0.8, 0, 1) });
          }
        }
      } else if (mode === "swim") {
        // 손바닥 중심이 최근 1초 평균 위치를 몇 도 돌았는지 쌓아 반 바퀴마다 한 번 젓는다(방향 무관)
        const W = S.sw;
        W.hist = W.hist.filter((h) => now - h.t < 1000);
        W.hist.push({ x: palm.x, y: palm.y, t: now });
        const cx = W.hist.reduce((a, h) => a + h.x, 0) / W.hist.length;
        const cy = W.hist.reduce((a, h) => a + h.y, 0) / W.hist.length;
        if (W.hist.length > 6 && Math.hypot((palm.x - cx) * 1.33, palm.y - cy) > 0.35 * size) {
          const a = Math.atan2(palm.y - cy, (palm.x - cx) * 1.33);
          if (W.prevA !== null) {
            let d = a - W.prevA;
            d = ((((d + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
            W.acc += d;
          }
          W.prevA = a;
          if (Math.abs(W.acc) >= Math.PI) {
            W.acc -= Math.sign(W.acc) * Math.PI;
            W.side ^= 1;
            emit("step", { side: W.side ? "R" : "L", via: "hand" });
          }
        } else {
          W.prevA = null;
          W.acc *= 0.9;
        }
      } else if (mode === "tug") {
        // 네 손가락 중 펴진 개수: 3개 이상 = 편 손, 1개 이하 = 주먹. 편 손 → 주먹이 될 때 한 번 당긴다
        const d = (a, b) => dist(lm[a], lm[b]);
        const n = [[8, 6], [12, 10], [16, 14], [20, 18]].filter(([t, q]) => d(t, 0) > d(q, 0) * 1.1).length;
        if (n >= 3) S.tug.open = true;
        else if (n <= 1 && S.tug.open) {
          S.tug.open = false;
          emit("step", { side: "L", via: "hand" });
        }
      } else if (mode === "arch") {
        // 엄지 끝(4)과 검지 끝(8)이 붙으면 시위를 잡은 것, 떨어지면 놓은 것
        const px = (lm[4].x + lm[8].x) / 2;
        const py = (lm[4].y + lm[8].y) / 2;
        const pd = dist(lm[4], lm[8]) / size;
        if (!S.pinch && pd < 0.3) {
          S.pinch = true;
          S.p0 = { x: px, y: py, s: size };
          emit("pinch", { phase: "start", x: px, y: py, s: size });
        } else if (S.pinch && pd > 0.48) {
          S.pinch = false;
          emit("pinch", { phase: "end" });
        } else if (S.pinch) {
          // 손을 움직이면 조준점 이동, 몸쪽으로 당기면(손이 작아지면) 당김이 찬다
          emit("pinch", {
            phase: "move",
            dx: -((px - S.p0.x) / S.p0.s) * 0.45,
            dy: -((py - S.p0.y) / S.p0.s) * 0.45, // 시작할 때 손 위치 기준 이동량 (조준점 = 시작 조준 + 이동량)
            pull: clamp((S.p0.s / size - 1) / 0.25, 0, 1),
          });
        }
      } else if (mode === "orch") {
        // 손 높이 = 크기: 마우스와 같은 move 이벤트로 바꿔 보낸다(y: 0 위, 1 아래)
        const h = clamp((0.85 - palm.y) / 0.65, 0, 1);
        emit("move", { x: palm.x, y: 0.9 - 0.8 * h, hand: true });
      }
    },
  };
  return api;
}
