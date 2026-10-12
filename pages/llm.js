// Claude와 대화하며 편집 (D-030). 사용자 본인 API 키로 브라우저에서 Messages API를 직접 부른다.
// 보내는 것: 문장·최근 대화·패널 id·치수·편집 이력 숫자 (이미지 없음, D-028).
// 받는 것: output_config.format JSON 스키마로 강제한 {reply, kind, ops, reason_code}.
// 받은 op는 여기서 다시 검사한 뒤 edit.js resolve(범위 검사 포함)로 넘긴다.

import { MAX_FACTOR, MIN_FACTOR } from "./edit.js";

export const API_URL = "https://api.anthropic.com/v1/messages";
export const MODELS = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5 (빠르고 저렴, 기본)" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-opus-5-5", label: "Opus 5.5 (가장 정확, 비쌈)" },
];
const HISTORY_TURNS = 8;
const OP_TYPES = ["rotate90", "scale_axis", "scale_uniform", "mirror", "stand_up", "invert_last", "round", "flatten", "taper"];
const AXES = ["screen_right", "screen_up", "toward_viewer"];

export const SYSTEM_PROMPT = `너는 Draw2World 데모에서 사용자와 대화하며 3D 물체를 고쳐 주는 도우미다. 메시를 직접 바꾸지 않고, 바꿀 내용을 정해진 JSON op로만 낸다.

물체는 그림 한 장(정면)을 두께 있게 밀어낸 것이라 처음엔 지우개처럼 두께가 어디서나 같다.
사용자는 6방향 패널(front/back/left/right/top/bottom) 중 하나를 보고 말한다. 방향어는 그 패널 화면 기준이다.
화면 축: screen_right(화면 오른쪽), screen_up(화면 위), toward_viewer(화면 밖, 보는 사람 쪽).

op 종류 (대상은 항상 물체 전체):
- rotate90 {axis, k}: axis 기준 오른손 법칙 k×90°. k는 -3..3, 0 제외. toward_viewer k=1은 화면에서 반시계.
  "앞으로 숙여" = screen_right k=1, "뒤로 젖혀" = screen_right k=-1, "옆모습이 보이게" = screen_up k=1.
- scale_axis {axis, factor}: 그 화면 방향으로만 늘이거나 줄임(0.1~10). 두께 = toward_viewer, 높이 = screen_up, 폭 = screen_right.
  배수가 없으면 "더/조금" 1.25(줄이면 0.8), "많이" 1.5, "살짝" 1.1.
- scale_uniform {factor}: 전체 크기.
- mirror {axis}: 그 방향 반전. 좌우 반전 = screen_right.
- stand_up: 가장 긴 축을 위로 세움(방향은 코드가 고름).
- invert_last: 직전 편집의 반대.
- round {mode, amount}: 두께 단면을 둥글게. mode "edge" = 가운데는 그대로, 가장자리가 (1-amount)배로 얇아짐(베개 모양). mode "bulge" = 가장자리는 그대로, 가운데가 (1+amount)배로 볼록. amount 0.1~0.9, 보통 0.6, "살짝" 0.35, "많이" 0.8.
- flatten: 지금까지의 round를 모두 없애 다시 평평한 판으로.
- taper {axis, ratio}: 화면 axis 방향(screen_right 또는 screen_up)으로 갈수록 두께가 ratio배가 되게(반대쪽 끝은 1/ratio 쪽). "위로 갈수록 얇게" = screen_up ratio 0.5, "아래가 두껍게" = screen_up ratio 0.5, "오른쪽을 두껍게" = screen_right ratio 2. ratio 0.1~10.

규칙:
- reply에는 사용자에게 하는 말을 짧은 한국어 존댓말로 쓴다. 바꿀 때는 무엇을 어떻게 바꾸는지 한 문장으로 설명한다.
- 편집을 하면 kind=ops, op는 최대 4개. 쓰지 않는 필드는 null.
- 특정 부위만 바꾸라는 요청(귀만 길게 등)은 아직 못 한다 → kind=refuse, reason_code=part_edit. 위·아래·좌·우 방향이나 가장자리 기준 편집으로 바꿔 제안한다.
- 모양 추가·삭제, 색 변경 → refuse, out_of_scope. 90° 배수가 아닌 회전 → refuse, angle_not_supported.
- 무엇을 원하는지 불분명하면 kind=clarify로 되묻는다. 편집과 상관없는 대화나 질문에는 kind=chat으로 답한다.
- 아무것도 바뀌지 않는 요청(360도 회전 등) → kind=noop.
- 사용자 메시지 끝의 [상태] JSON은 현재 패널·치수(m)·지금까지의 편집이다. 이를 참고해 "더", "조금 더" 같은 말을 해석한다.`;

const nullable = (type, extra = {}) => ({ type: [type, "null"], ...extra });

export const CHAT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    kind: { type: "string", enum: ["ops", "refuse", "clarify", "noop", "chat"] },
    ops: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: OP_TYPES },
          axis: nullable("string", { enum: [...AXES, null] }),
          k: nullable("integer"),
          factor: nullable("number"),
          mode: nullable("string", { enum: ["edge", "bulge", null] }),
          amount: nullable("number"),
          ratio: nullable("number"),
        },
        required: ["type", "axis", "k", "factor", "mode", "amount", "ratio"],
        additionalProperties: false,
      },
    },
    reason_code: nullable("string", { enum: ["part_edit", "out_of_scope", "angle_not_supported", "out_of_range", null] }),
  },
  required: ["reply", "kind", "ops", "reason_code"],
  additionalProperties: false,
};

/** 대화 이력([{role: user|assistant, text}]) + 이번 문장·상태 → Messages API 요청 본문 */
export function buildRequest({ model, history, text, state }) {
  const turns = history.slice(-HISTORY_TURNS * 2).filter((m) => m.text.trim());
  const messages = [];
  for (const m of turns) {
    // user/assistant가 번갈아 오도록 같은 역할이 이어지면 합친다
    const last = messages[messages.length - 1];
    if (last && last.role === m.role) last.content += `\n${m.text}`;
    else messages.push({ role: m.role, content: m.text });
  }
  while (messages.length && messages[0].role !== "user") messages.shift();
  const content = `${text}\n\n[상태] ${JSON.stringify(state)}`;
  const last = messages[messages.length - 1];
  if (last && last.role === "user") last.content += `\n${content}`;
  else messages.push({ role: "user", content });
  return {
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages,
    output_config: { format: { type: "json_schema", schema: CHAT_SCHEMA } },
  };
}

/** 스키마로 막을 수 없는 범위(배율·k)까지 검사하고 null 필드를 버린 화면 op 리스트. 위반이면 Error */
export function parseReply(raw) {
  const data = JSON.parse(raw);
  const ops = (data.ops ?? []).map((op) => Object.fromEntries(Object.entries(op).filter(([, v]) => v !== null)));
  for (const op of ops) {
    const bad = (why) => new Error(`Claude가 잘못된 편집을 보냈어요 (${op.type}: ${why}).`);
    if (!OP_TYPES.includes(op.type)) throw bad("알 수 없는 종류");
    if (["rotate90", "scale_axis", "mirror", "taper"].includes(op.type) && !AXES.includes(op.axis)) throw bad("축 없음");
    if (op.type === "taper" && op.axis === "toward_viewer") throw bad("두께 방향으로는 taper 불가");
    if (op.type === "rotate90" && !(Number.isInteger(op.k) && op.k !== 0 && Math.abs(op.k) <= 3)) throw bad("k");
    if (["scale_axis", "scale_uniform"].includes(op.type) && !(op.factor >= MIN_FACTOR && op.factor <= MAX_FACTOR)) throw bad("factor 범위");
    if (op.type === "taper" && !(op.ratio >= MIN_FACTOR && op.ratio <= MAX_FACTOR)) throw bad("ratio 범위");
    if (op.type === "round" && !(["edge", "bulge"].includes(op.mode) && op.amount > 0 && op.amount < 1)) throw bad("mode·amount");
  }
  if (data.kind === "ops" && !ops.length) throw new Error("Claude가 편집한다고 했지만 op가 없어요.");
  return { reply: String(data.reply ?? ""), kind: data.kind, ops: data.kind === "ops" ? ops.slice(0, 4) : [], reason_code: data.reason_code ?? null };
}

/** Claude 호출. fetchImpl은 테스트에서 바꿔 끼운다. 실패는 사용자에게 보여 줄 한국어 Error */
export async function chatWithClaude({ apiKey, model, history, text, state, fetchImpl = fetch }) {
  const body = buildRequest({ model, history, text, state });
  let res;
  try {
    res = await fetchImpl(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`Claude에 연결하지 못했어요 (${e.message}).`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new Error(`API 키가 올바르지 않아요. 키를 다시 확인해 주세요. (${detail})`);
    if (res.status === 429) throw new Error(`요청이 너무 많거나 사용 한도에 걸렸어요. 잠시 뒤 다시 해 주세요. (${detail})`);
    throw new Error(`Claude 요청이 실패했어요: ${detail}`);
  }
  if (data.stop_reason === "refusal") throw new Error("Claude가 이 요청에는 답하지 않았어요. 다르게 말해 주세요.");
  if (data.stop_reason === "max_tokens") throw new Error("Claude 답이 너무 길어 잘렸어요. 짧게 다시 말해 주세요.");
  const raw = (data.content ?? []).find((b) => b.type === "text")?.text;
  if (!raw) throw new Error("Claude 답에 내용이 없어요.");
  return parseReply(raw);
}
