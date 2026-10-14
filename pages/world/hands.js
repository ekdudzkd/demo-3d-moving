// 웹캠 손 인식(선택). 켜기를 누르고 동의한 뒤에만 카메라를 쓰고, 영상은 이 브라우저 안에서만 처리한다(저장·전송 없음).
// 손 좌표 → 입력 이벤트 변환은 logic/gestures.js(순수 함수). 여기서는 카메라·모델·미리보기·상태 표시만 맡는다.
import { createGestureMapper } from "./logic/gestures.js";
import { createBodyMapper, puppetOf, toBody } from "./logic/body.js";

const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

/** 손 인식기. GPU로 만들고, 만들기나 첫 검출이 실패하면 CPU로 다시 만든다 */
async function loadDetector(log, kind = "hand") {
  const stub = kind === "body" ? window.__d2wPoseDetector : window.__d2wHandDetector; // 테스트용 대체 검출기
  if (stub) return stub;
  const vision = await import(`${VISION}/vision_bundle.mjs`);
  const fileset = await vision.FilesetResolver.forVisionTasks(`${VISION}/wasm`);
  const make = (delegate) =>
    kind === "body"
      ? vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: POSE_MODEL, delegate },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        })
      : vision.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL, delegate },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
  let delegate = "GPU";
  let lmk;
  try {
    lmk = await make("GPU");
  } catch (e) {
    log("GPU 손 인식 실패, CPU로 전환", e);
    delegate = "CPU";
    lmk = await make("CPU");
  }
  let errors = 0;
  const det = {
    get delegate() {
      return delegate;
    },
    detect(video, now) {
      try {
        const r = lmk.detectForVideo(video, now);
        errors = 0;
        return r.landmarks?.[0] ?? null;
      } catch (e) {
        errors++;
        // GPU에서 검출이 계속 실패하는 그래픽 환경이 있다 → CPU로 한 번 바꾼다
        if (errors >= 3 && delegate === "GPU" && !det.switching) {
          det.switching = true;
          log("GPU 검출 오류 반복, CPU로 전환", e);
          make("CPU")
            .then((n) => {
              lmk.close();
              lmk = n;
              delegate = "CPU";
              errors = 0;
            })
            .catch((e2) => log("CPU 손 인식도 실패", e2))
            .finally(() => (det.switching = false));
        }
        throw e;
      }
    },
    close: () => lmk.close(),
  };
  return det;
}

/** 카메라 오류를 사람이 할 수 있는 일로 바꾼다 */
export function cameraErrorText(e) {
  const n = e?.name || "";
  if (!window.isSecureContext) return "카메라는 http://localhost 또는 https 주소에서만 켜져요. 주소를 확인해 주세요";
  if (n === "NotAllowedError" || n === "SecurityError") return "카메라 권한이 막혀 있어요. 주소창 왼쪽 아이콘 → 카메라 '허용'으로 바꾼 뒤 다시 켜 주세요";
  if (n === "NotFoundError" || n === "OverconstrainedError" || n === "NotSupportedError") return "카메라를 찾지 못했어요. 웹캠이 연결돼 있는지 확인해 주세요";
  if (n === "NotReadableError" || n === "AbortError") return "카메라를 열 수 없어요. 다른 프로그램(Zoom·Teams·카메라 앱·다른 탭)이 쓰고 있으면 닫고 다시 켜 주세요";
  if (n === "no-media") return "이 브라우저는 카메라를 지원하지 않아요. 최신 Chrome·Edge로 열어 주세요";
  return null;
}

const CHAINS = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20], [5, 9, 13, 17, 0]];
const BODY_CHAINS = [[15, 13, 11, 12, 14, 16], [11, 23, 24, 12], [23, 25, 27], [24, 26, 28]];

/**
 * @param {{input: object, container: HTMLElement, onChange?: (s: {state: string, error?: string}) => void}} o
 */
export function createHands({ input, container, onChange = () => {} }) {
  const emit = (name, data) => input.emit(name, data);
  const mappers = { hand: createGestureMapper(emit), body: createBodyMapper(emit) };
  let kind = "hand"; // hand: 손가락 인식, body: 몸 인식
  let mapper = mappers.hand;
  let mode = "free";
  let body = null; // 몸 인식 최근 값(따라하기용)
  let state = "off"; // off | loading | on
  let video = null;
  let stream = null;
  let detector = null;
  let raf = 0;
  let lastT = -1;
  let lm = null;
  let gen = 0;
  let lastEvent = "";
  let lastEventT = 0;
  const status = { step: "", error: "", detail: "" };
  window.__d2wHandStatus = status; // 문제 확인용

  const log = (msg, e) => {
    status.detail = `${msg}: ${e?.name || ""} ${e?.message || e || ""}`.trim();
    console.warn("[손동작]", msg, e);
  };

  const box = document.createElement("div");
  box.className = "wf-cam";
  box.hidden = true;
  const cv = document.createElement("canvas");
  cv.width = 240;
  cv.height = 180;
  const cap = document.createElement("small");
  box.append(cv, cap);
  container.append(box);
  const g = cv.getContext("2d");

  // 지금 어떤 손동작이 들어왔는지 잠깐 보여 준다
  const NAMES = { step: "걸음·젓기·당기기", jump: "점프!", pinch: "집기", move: "지휘" };
  const unsub = ["step", "jump", "pinch"].map((n) =>
    input.on(n, (d) => {
      if (d?.via !== "hand" && d?.via !== "body" && n !== "pinch") return;
      lastEvent = n === "pinch" ? (d.phase === "start" ? "시위를 잡았어요" : d.phase === "end" ? "발사!" : lastEvent) : n === "step" ? `${NAMES.step} ${d.side === "L" ? "◀" : "▶"}` : NAMES[n];
      lastEventT = performance.now();
    }),
  );

  const set = (s, error) => {
    state = s;
    box.hidden = s === "off";
    status.error = error || "";
    onChange({ state: s, error });
  };
  const step = (text) => {
    status.step = text;
    cap.textContent = text;
    g.fillStyle = "#1c252b";
    g.fillRect(0, 0, cv.width, cv.height);
  };

  function draw() {
    if (!video) return;
    g.save();
    g.translate(cv.width, 0);
    g.scale(-1, 1);
    g.drawImage(video, 0, 0, cv.width, cv.height);
    g.restore();
    const who = kind === "body" ? "몸" : "손";
    if (!lm) {
      cap.textContent = kind === "body" ? "몸이 안 보여요 — 카메라에서 조금 떨어져 상반신 이상이 보이게 서 주세요" : mapper.mode === "free" ? "손이 안 보여요 · 종목에 들어가면 손동작이 적용돼요" : "손이 안 보여요 — 손바닥을 카메라에 보여 주세요";
      return;
    }
    if (kind === "body") {
      const recentB = performance.now() - lastEventT < 700 ? lastEvent : "";
      const legs = body?.legsVis;
      cap.textContent = recentB || (mapper.mode === "free" ? (legs ? "몸 인식 중 · 캐릭터가 따라 해요" : "상반신 인식 중 · 캐릭터 팔이 따라 해요") : legs ? "전신 인식 · 제자리 뛰기로 달려요" : "상반신 인식 · 팔을 번갈아 흔들어 달려요");
      const P = (i) => [cv.width - lm[i].x * cv.width, lm[i].y * cv.height];
      g.lineWidth = 3;
      g.strokeStyle = "rgba(255,255,255,.85)";
      for (const ids of BODY_CHAINS) {
        g.beginPath();
        let started = false;
        for (const i of ids) {
          if ((lm[i].visibility ?? 1) < 0.5) {
            started = false;
            continue;
          }
          const [x, y] = P(i);
          started ? g.lineTo(x, y) : g.moveTo(x, y);
          started = true;
        }
        g.stroke();
      }
      for (const i of [0, 15, 16, 25, 26]) {
        if ((lm[i].visibility ?? 1) < 0.5) continue;
        const [x, y] = P(i);
        g.fillStyle = i === 0 ? "#ffc93c" : i < 20 ? "#ff5a47" : "#4f7dff";
        g.beginPath();
        g.arc(x, y, 5, 0, 7);
        g.fill();
      }
      return;
    }
    const recent = performance.now() - lastEventT < 700 ? lastEvent : "";
    cap.textContent = mapper.mode === "free" ? `${who} 인식 중 · 종목에 들어가면 손동작이 적용돼요` : recent || `${who} 인식 중`;
    const P = (i) => [cv.width - lm[i].x * cv.width, lm[i].y * cv.height];
    g.lineWidth = 2;
    g.strokeStyle = "rgba(255,255,255,.8)";
    for (const ids of CHAINS) {
      g.beginPath();
      ids.forEach((i, n) => {
        const [x, y] = P(i);
        n ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      g.stroke();
    }
    for (const i of [4, 8, 12]) {
      const [x, y] = P(i);
      g.fillStyle = i === 4 ? "#4f7dff" : i === 8 ? "#ff5a47" : "#ffc93c";
      g.beginPath();
      g.arc(x, y, 5, 0, 7);
      g.fill();
    }
  }

  function tick() {
    raf = requestAnimationFrame(tick);
    if (state !== "on" || !video || video.readyState < 2 || video.currentTime === lastT) return;
    lastT = video.currentTime;
    try {
      lm = detector.detect(video, performance.now());
    } catch {
      lm = null;
    }
    const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3;
    if (lm) {
      const b = mapper.feed(lm, performance.now(), aspect);
      body = kind === "body" ? b || toBody(lm, aspect) : null;
    } else {
      mapper.lost();
      body = null;
    }
    draw();
  }

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("mediaDevices 없음"), { name: window.isSecureContext ? "no-media" : "SecurityError" });
    try {
      return await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false });
    } catch (e) {
      // 해상도·방향 조건을 못 맞추는 카메라가 있다 → 조건 없이 한 번 더
      if (e?.name === "OverconstrainedError" || e?.name === "NotReadableError" || e?.name === "AbortError") {
        log("카메라 조건 완화 후 재시도", e);
        return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      throw e;
    }
  }

  const api = {
    get state() {
      return state;
    },
    get active() {
      return state === "on";
    },
    status,
    get kind() {
      return kind;
    },
    /** 몸으로 플레이할 때 캐릭터가 따라 할 팔다리 방향 (없으면 null) */
    get puppet() {
      return state === "on" && kind === "body" && body ? puppetOf(body) : null;
    },
    setMode: (m) => {
      mode = m;
      mapper.setMode(m);
    },
    /** k: 'hand'(손가락) | 'body'(몸). 이미 다른 종류로 켜져 있으면 끄고 다시 켠다 */
    async enable(k = "hand") {
      if (state !== "off" && kind === k) return;
      if (state !== "off") api.disable();
      kind = k;
      mapper = mappers[k];
      mapper.setMode(mode);
      const my = ++gen;
      set("loading");
      let stage = "camera";
      try {
        step("카메라 켜는 중… (브라우저가 허용을 물으면 '허용')");
        stream = await openCamera();
        video = document.createElement("video");
        video.playsInline = true;
        video.muted = true;
        video.srcObject = stream;
        await video.play();
        if (my !== gen) return;
        stage = "model";
        step(kind === "body" ? "몸 인식 모델 불러오는 중… (처음 한 번 몇 초)" : "손 인식 모델 불러오는 중… (처음 한 번 몇 초)");
        const d = await loadDetector(log, kind);
        if (my !== gen) {
          try {
            d.close?.();
          } catch {
            /* 무시 */
          }
          return;
        }
        detector = d;
        set("on");
        tick();
      } catch (e) {
        log(stage === "camera" ? "카메라 열기 실패" : "손 인식 모델 불러오기 실패", e);
        const text = stage === "camera" ? cameraErrorText(e) || `카메라를 켜지 못했어요 (${e?.name || "알 수 없는 오류"})` : "손 인식 모델을 불러오지 못했어요. 인터넷 연결(cdn.jsdelivr.net, storage.googleapis.com)을 확인해 주세요";
        api.disable();
        set("off", text);
      }
    },
    disable() {
      gen++;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      video = null;
      try {
        detector?.close?.();
      } catch {
        /* 닫는 중 오류는 무시 */
      }
      detector = null;
      lm = null;
      body = null;
      mapper.lost();
      if (state !== "off") set("off");
    },
    dispose() {
      api.disable();
      unsub.forEach((f) => f());
      box.remove();
    },
  };
  return api;
}
