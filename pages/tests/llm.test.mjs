// 5-8 Claude 대화형 편집 (D-030): 가짜 fetch로 요청 형태·응답 검증·오류 메시지를 검사한다 (네트워크·키 없음).
import assert from "node:assert/strict";
import { test } from "node:test";

import { API_URL, CHAT_SCHEMA, buildRequest, chatWithClaude, parseReply } from "../llm.js";

const op = (o) => ({ type: null, axis: null, k: null, factor: null, mode: null, amount: null, ratio: null, ...o });
const reply = (data, extra = {}) => ({ ok: true, status: 200, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(data) }], ...extra }) });

function fakeFetch(...responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return responses.shift();
  };
  fn.calls = calls;
  return fn;
}

const STATE = { panel: "right", size_m: { x: 0.82, y: 1, z: 0.25 }, edits: [], version: "e0" };

test("요청: 키·CORS 헤더, 모델, JSON 스키마 출력, 이미지 없이 대화 이력 + 상태", async () => {
  const fetchImpl = fakeFetch(reply({ reply: "가장자리를 둥글게 할게요.", kind: "ops", ops: [op({ type: "round", mode: "edge", amount: 0.6 })], reason_code: null }));
  const history = [
    { role: "assistant", text: "이제 Claude와 대화하며 고쳐요." },
    { role: "user", text: "[오른쪽] 좀 둥글게" },
    { role: "assistant", text: "가장자리를 둥글게 했어요." },
    { role: "assistant", text: "편집: e1 적용 완료" },
  ];
  const r = await chatWithClaude({ apiKey: "sk-test", model: "claude-haiku-5-5", history, text: "[right 패널] 조금 더", state: STATE, fetchImpl });
  assert.equal(r.kind, "ops");
  const { url, init, body } = fetchImpl.calls[0];
  assert.equal(url, API_URL);
  assert.equal(init.headers["x-api-key"], "sk-test");
  assert.equal(init.headers["anthropic-version"], "2023-06-01");
  assert.equal(init.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(body.model, "claude-haiku-5-5");
  assert.deepEqual(body.output_config.format, { type: "json_schema", schema: CHAT_SCHEMA });
  // 첫 메시지는 user, 역할은 번갈아, 연속 assistant는 합쳐짐, 맨 앞 assistant는 버림
  assert.deepEqual(body.messages.map((m) => m.role), ["user", "assistant", "user"]);
  assert.match(body.messages[1].content, /가장자리를 둥글게 했어요\.\n편집: e1 적용 완료/);
  assert.match(body.messages[2].content, /^\[right 패널\] 조금 더\n\n\[상태\] \{"panel":"right"/);
  // 모든 content가 문자열 (이미지 블록 없음)
  assert.ok(body.messages.every((m) => typeof m.content === "string"));
});

test("응답: null 필드를 버린 화면 op로 바꾼다", () => {
  const r = parseReply(JSON.stringify({ reply: "위로 갈수록 얇게 할게요.", kind: "ops", ops: [op({ type: "taper", axis: "screen_up", ratio: 0.5 })], reason_code: null }));
  assert.deepEqual(r.ops, [{ type: "taper", axis: "screen_up", ratio: 0.5 }]);
  assert.equal(r.reply, "위로 갈수록 얇게 할게요.");
});

test("응답: 대화·거절은 op 없이 답만", () => {
  const chat = parseReply(JSON.stringify({ reply: "안녕하세요! 어떻게 고칠까요?", kind: "chat", ops: [], reason_code: null }));
  assert.deepEqual([chat.kind, chat.ops], ["chat", []]);
  const refuse = parseReply(JSON.stringify({ reply: "귀만 따로는 아직 못 해요. 위쪽을 길게 할까요?", kind: "refuse", ops: [], reason_code: "part_edit" }));
  assert.equal(refuse.reason_code, "part_edit");
});

test("응답: 스키마로 못 막는 범위 위반은 거절", () => {
  const bad = (o, kind = "ops") => () => parseReply(JSON.stringify({ reply: "", kind, ops: o, reason_code: null }));
  assert.throws(bad([op({ type: "scale_axis", axis: "screen_up", factor: 20 })]), /factor 범위/);
  assert.throws(bad([op({ type: "taper", axis: "toward_viewer", ratio: 2 })]), /두께 방향/);
  assert.throws(bad([op({ type: "rotate90", axis: "screen_up", k: 0 })]), /k/);
  assert.throws(bad([op({ type: "round", mode: "edge", amount: 1.5 })]), /mode·amount/);
  assert.throws(bad([]), /op가 없어요/);
});

test("오류: 키 오류·한도·거부는 알아볼 수 있는 한국어로", async () => {
  const err = (status, message) => ({ ok: false, status, json: async () => ({ error: { message } }) });
  const call = (res) => chatWithClaude({ apiKey: "k", model: "m", history: [], text: "t", state: STATE, fetchImpl: fakeFetch(res) });
  await assert.rejects(call(err(401, "invalid x-api-key")), /API 키가 올바르지 않아요/);
  await assert.rejects(call(err(429, "rate limited")), /사용 한도/);
  await assert.rejects(call(reply({}, { stop_reason: "refusal", content: [] })), /답하지 않았어요/);
  await assert.rejects(
    chatWithClaude({ apiKey: "k", model: "m", history: [], text: "t", state: STATE, fetchImpl: async () => { throw new TypeError("Failed to fetch"); } }),
    /연결하지 못했어요/,
  );
});

test("요청 본문: 대화가 길면 최근 것만", () => {
  const history = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `m${i}` }));
  const body = buildRequest({ model: "m", history, text: "now", state: STATE });
  assert.ok(body.messages.length <= 17);
  assert.ok(!body.messages.some((m) => m.content === "m0"));
});
