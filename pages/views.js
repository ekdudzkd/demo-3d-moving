// 6방향 예상 그림 (D-031): Claude가 그림 한 장에서 옆·위 외곽선·두께와 각 방향 모습을 그리고,
// 대화로 고친 외곽선으로 3D 두께를 정한다 (DOM 없음, Node에서 테스트).
//
// 좌표: 각 뷰는 자기 화면 기준 상자 안 [u, v] ∈ [0,1]², u 오른쪽·v 아래.
//   left  : 상자 = 두께 D × 높이 H, 화면 오른쪽 = 물체 앞(+z)  (basis.json left)
//   top   : 상자 = 가로 W × 두께 D, 화면 아래 = 물체 앞(+z)    (basis.json top)
//   right·back·bottom 외곽선은 left·front·top의 거울 (기하는 같아야 함). 모습(부분 색)만 따로.

import { callClaude } from "./llm.js";

export const VIEW_KEYS = ["back", "left", "right", "top", "bottom"];
const OUTLINED = ["left", "top"];
const DEFAULT_COLOR = "#9aa3a8";

const point = { type: "array", items: { type: "number" } };
const polygon = { type: "array", items: point };
const part = {
  type: "object",
  properties: { name: { type: "string" }, color: { type: "string" }, points: polygon },
  required: ["name", "color", "points"],
  additionalProperties: false,
};
const look = (outline) => ({
  type: "object",
  properties: { ...(outline ? { outline: polygon } : {}), base_color: { type: "string" }, parts: { type: "array", items: part } },
  required: [...(outline ? ["outline"] : []), "base_color", "parts"],
  additionalProperties: false,
});

export const VIEWS_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    changed: { type: "boolean" },
    depth_ratio: { type: "number" },
    views: {
      type: "object",
      properties: Object.fromEntries(VIEW_KEYS.map((k) => [k, look(OUTLINED.includes(k))])),
      required: VIEW_KEYS,
      additionalProperties: false,
    },
  },
  required: ["reply", "changed", "depth_ratio", "views"],
  additionalProperties: false,
};

export const VIEWS_PROMPT = `너는 그림 한 장(물체의 정면)을 보고 그 물체를 뒤·왼쪽·오른쪽·위·아래에서 본 모습을 예상해 단순한 설계도 그림으로 그리는 도우미다. 그림은 JSON 다각형으로만 낸다.

좌표 규칙 (모든 점은 [u, v], 0~1, u는 화면 오른쪽, v는 화면 아래):
- depth_ratio: 물체 두께(앞뒤 길이) ÷ 정면 가로 폭. 납작한 물체 0.1~0.3, 둥근 몸통 0.6~1.0.
- left(왼쪽에서 본 모습): 상자 = 가로 두께 × 세로 높이. 화면 오른쪽이 물체의 앞(얼굴 쪽). outline은 옆모습 외곽선이고 위아래로 상자를 꽉 채운다(v 0~1 = 정면 그림의 맨 위~맨 아래와 같은 높이).
- top(위에서 내려다본 모습): 상자 = 가로 폭 × 세로 두께. 화면 아래가 물체의 앞. outline은 위에서 본 외곽선이고 좌우로 상자를 꽉 채운다(u 0~1 = 정면 그림의 맨 왼쪽~맨 오른쪽).
- back·right·bottom의 외곽선은 각각 정면·left·top의 거울이라 따로 그리지 않는다. 대신 그 방향에서 보이는 색과 부분(parts)만 그 화면 기준 좌표로 그린다(back은 정면 그림의 외곽 상자, right는 left 상자, bottom은 top 상자).
- base_color: 그 방향에서 대부분 보이는 색(#rrggbb). parts: 눈에 띄는 부분(머리 리본, 옷, 바퀴 등)을 이름·색·다각형으로. 뷰마다 parts 12개 이하, 다각형은 점 30개 이하, outline은 점 40개 이하.
- 그림과 그 물체에 대한 상식으로 예상한다. 보이지 않는 면은 추측임을 알고 단순하게 그린다.

대화 규칙:
- reply에 한국어 존댓말로 짧게 무엇을 그렸는지/고쳤는지 말한다.
- 사용자가 고쳐 달라고 하면 [현재 예상 그림]을 바탕으로 요청한 부분만 고치고 나머지는 그대로 둔 전체 JSON을 다시 낸다. changed=true.
- 그림과 상관없는 말이나 질문이면 [현재 예상 그림]을 그대로 내고 changed=false.`;

/** 요청 본문: 그림(PNG base64) + 정면 비율 + (있으면) 현재 예상 그림·최근 대화 + 이번 요청 */
export function buildViewsRequest({ model, pngBase64, front, current, history = [], text }) {
  const lines = [`[정면] 이 그림이 물체의 정면이다. 정면 외곽 상자 가로:세로 = ${front.width.toFixed(3)}:${front.height.toFixed(3)}.`];
  if (current) lines.push(`[현재 예상 그림] ${JSON.stringify(toWire(current))}`);
  const recent = history.slice(-8).map((m) => `${m.role === "user" ? "사용자" : "도우미"}: ${m.text}`);
  if (recent.length) lines.push(`[최근 대화]\n${recent.join("\n")}`);
  lines.push(`[요청] ${text || "뒤·왼쪽·오른쪽·위·아래 모습을 예상해 그려 줘."}`);
  return {
    model,
    max_tokens: 8000,
    system: VIEWS_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: pngBase64 } },
          { type: "text", text: lines.join("\n\n") },
        ],
      },
    ],
    output_config: { format: { type: "json_schema", schema: VIEWS_SCHEMA } },
  };
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const color = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : DEFAULT_COLOR);

function cleanPolygon(points, what) {
  if (!Array.isArray(points)) throw new Error(`${what}: 점 목록이 아니에요.`);
  const out = points
    .filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map(([u, v]) => [clamp01(u), clamp01(v)]);
  return out.length >= 3 ? out : null;
}

/** Claude 응답 → 검사·정리된 예상 그림. 쓸 수 없으면 한국어 Error */
export function parseViews(raw) {
  const data = JSON.parse(raw);
  const depthRatio = Number(data.depth_ratio);
  if (!(depthRatio >= 0.05 && depthRatio <= 2)) throw new Error(`두께 비율이 이상해요 (${data.depth_ratio}).`);
  const views = {};
  for (const key of VIEW_KEYS) {
    const v = data.views?.[key];
    if (!v) throw new Error(`${key} 그림이 없어요.`);
    const parts = (v.parts ?? [])
      .map((p) => ({ name: String(p.name ?? ""), color: color(p.color), points: cleanPolygon(p.points, `${key}.${p.name}`) }))
      .filter((p) => p.points);
    views[key] = { base_color: color(v.base_color), parts };
    if (OUTLINED.includes(key)) {
      const outline = cleanPolygon(v.outline, `${key} 외곽선`);
      if (!outline) throw new Error(`${key} 외곽선이 비었어요.`);
      views[key].outline = outline;
    }
  }
  return { reply: String(data.reply ?? ""), changed: Boolean(data.changed), depthRatio, views };
}

/** 다시 보낼 때는 응답 스키마와 같은 모양으로 */
function toWire(cur) {
  return { depth_ratio: cur.depthRatio, views: cur.views };
}

export async function predictViews({ apiKey, model, pngBase64, front, current = null, history = [], text = "", fetchImpl = fetch }) {
  const body = buildViewsRequest({ model, pngBase64, front, current, history, text });
  return parseViews(await callClaude({ apiKey, body, fetchImpl }));
}

// ---------------------------------------------------------------------------
// 외곽선 → 두께 (실루엣 교차)
// ---------------------------------------------------------------------------

/** 다각형과 v = const 가로줄이 만나는 u 범위 [min, max] (없으면 null) */
export function spanAtV(poly, v) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [u0, v0] = poly[i];
    const [u1, v1] = poly[(i + 1) % poly.length];
    if ((v0 - v) * (v1 - v) > 0 || v0 === v1) continue;
    const u = u0 + ((v - v0) * (u1 - u0)) / (v1 - v0);
    lo = Math.min(lo, u);
    hi = Math.max(hi, u);
  }
  return lo <= hi ? [lo, hi] : null;
}

/** 다각형과 u = const 세로줄이 만나는 v 범위 */
export const spanAtU = (poly, u) => spanAtV(poly.map(([a, b]) => [b, a]), u);

/**
 * 정면 외곽 상자(x·y, 메시 단위)와 예상 그림 → 정면 점 (x, y)에서의 두께 구간 [z뒤, z앞].
 * 옆 외곽선의 그 높이 구간 ∩ 위 외곽선의 그 가로 위치 구간. 비면 아주 얇게(두께의 1%).
 */
export function hullDepth(cur, box) {
  const W = box.xmax - box.xmin;
  const H = box.ymax - box.ymin;
  const D = cur.depthRatio * W;
  const side = cur.views.left.outline;
  const top = cur.views.top.outline;
  const eps = 0.005 * D;
  return (x, y) => {
    // 경계 점이 다각형 꼭짓점과 딱 맞물리지 않게 아주 조금 안쪽에서 잰다
    const v = clamp01((box.ymax - y) / H) * 0.998 + 0.001;
    const u = clamp01((x - box.xmin) / W) * 0.998 + 0.001;
    const s = spanAtV(side, v);
    const t = spanAtU(top, u);
    const toZ = (a) => -D / 2 + a * D;
    if (s && t) {
      const z0 = Math.max(toZ(s[0]), toZ(t[0]));
      const z1 = Math.min(toZ(s[1]), toZ(t[1]));
      if (z1 - z0 > 2 * eps) return [z0, z1];
      const mid = (z0 + z1) / 2;
      return [mid - eps, mid + eps];
    }
    const only = s ?? t;
    const mid = only ? toZ((only[0] + only[1]) / 2) : 0;
    return [mid - eps, mid + eps];
  };
}
