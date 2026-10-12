// 5-9 6방향 예상 그림 (D-031): 요청(그림 포함)·응답 검사·외곽선 → 두께(실루엣 교차)
import assert from "node:assert/strict";
import { test } from "node:test";

import { generateMesh } from "../pipeline.js";
import { VIEWS_SCHEMA, buildViewsRequest, hullDepth, parseViews, predictViews, spanAtU, spanAtV } from "../views.js";

const rect = [[0, 0], [1, 0], [1, 1], [0, 1]];
const look = (extra = {}) => ({ base_color: "#ff88aa", parts: [], ...extra });
const views = (left, top, depth = 0.5) => ({ depthRatio: depth, views: { back: look(), left: look({ outline: left }), right: look(), top: look({ outline: top }), bottom: look() } });
const wire = (cur, extra = {}) => JSON.stringify({ reply: "그렸어요", changed: true, depth_ratio: cur.depthRatio, views: cur.views, ...extra });
const close = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);

test("요청: 그림(PNG)을 이미지 블록으로, 정면 비율·현재 그림·최근 대화·요청을 텍스트로", () => {
  const cur = views(rect, rect);
  const body = buildViewsRequest({
    model: "claude-haiku-5-5",
    pngBase64: "iVBORw0KGgo=",
    front: { width: 0.4, height: 0.8 },
    current: cur,
    history: [{ role: "user", text: "옆모습 둥글게" }, { role: "assistant", text: "둥글게 했어요" }],
    text: "더 두껍게",
  });
  assert.deepEqual(body.output_config.format, { type: "json_schema", schema: VIEWS_SCHEMA });
  const [img, txt] = body.messages[0].content;
  assert.deepEqual(img, { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } });
  assert.match(txt.text, /가로:세로 = 0\.400:0\.800/);
  assert.match(txt.text, /\[현재 예상 그림\] \{"depth_ratio":0\.5/);
  assert.match(txt.text, /사용자: 옆모습 둥글게\n도우미: 둥글게 했어요/);
  assert.match(txt.text, /\[요청\] 더 두껍게$/);
});

test("응답: 범위 밖 좌표는 0~1로, 점 3개 미만 부분은 버리고, 색은 #rrggbb만", () => {
  const raw = wire(views([[-0.2, 0], [1.3, 0], [1, 1], [0, 1]], rect), {});
  const data = JSON.parse(raw);
  data.views.back.parts = [{ name: "리본", color: "red", points: [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]] }, { name: "점", color: "#000000", points: [[0.5, 0.5]] }];
  const r = parseViews(JSON.stringify(data));
  assert.deepEqual(r.views.left.outline[0], [0, 0]);
  assert.deepEqual(r.views.left.outline[1], [1, 0]);
  assert.equal(r.views.back.parts.length, 1);
  assert.equal(r.views.back.parts[0].color, "#9aa3a8");
  assert.throws(() => parseViews(wire(views(rect, rect, 5))), /두께 비율/);
  assert.throws(() => parseViews(wire(views([[0, 0], [1, 1]], rect))), /외곽선/);
});

test("외곽선 구간: 사각형·삼각형", () => {
  assert.deepEqual(spanAtV(rect, 0.5), [0, 1]);
  const tri = [[0.5, 0], [1, 1], [0, 1]]; // 위가 뾰족
  const [a, b] = spanAtV(tri, 0.5);
  close(a, 0.25, 1e-12);
  close(b, 0.75, 1e-12);
  assert.equal(spanAtV(tri, 1.5), null);
  assert.deepEqual(spanAtU(rect, 0.3), [0, 1]);
});

test("두께: 옆·위 외곽선 구간의 교집합, 비면 아주 얇게", () => {
  const box = { xmin: -0.2, xmax: 0.2, ymin: -0.4, ymax: 0.4 };
  const D = 0.5 * 0.4;
  const full = hullDepth(views(rect, rect), box);
  const [z0, z1] = full(0, 0);
  close(z1 - z0, D, 1e-9);
  // 옆모습이 위로 갈수록 좁은 삼각형이면 위쪽이 얇다
  const tri = hullDepth(views([[0.5, 0], [1, 1], [0, 1]], rect), box);
  const thick = (y) => tri(0, y)[1] - tri(0, y)[0];
  assert.ok(thick(0.3) < thick(-0.3) * 0.5, `${thick(0.3)} vs ${thick(-0.3)}`);
  // 위모습이 앞쪽 절반만 차지하면 두께 구간도 앞쪽 절반
  const half = hullDepth(views(rect, [[0, 0.5], [1, 0.5], [1, 1], [0, 1]]), box);
  const [h0, h1] = half(0, 0);
  close(h0, 0, 1e-3 * D + 1e-9);
  close(h1, D / 2, 1e-3 * D + 1e-9);
});

test("그림으로 3D: 원 그림 + 위가 뾰족한 옆모습 → 메시 두께가 위로 갈수록 얇다", () => {
  const S = 256;
  const mask = new Uint8Array(S * S);
  const rgba = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const inside = (x - 128) ** 2 + (y - 128) ** 2 < 90 ** 2;
      mask[y * S + x] = inside ? 1 : 0;
      rgba.set(inside ? [230, 80, 120, 255] : [255, 255, 255, 255], (y * S + x) * 4);
    }
  }
  const seg = { mask, size: S, rgba: { data: rgba, width: S, height: S } };
  const cur = views([[0.5, 0], [1, 1], [0, 1]], rect, 0.6);
  const { mesh, info } = generateMesh(seg, { artifacts: false, makeDepth: (box) => hullDepth(cur, box) });
  assert.equal(info.mode, "views");
  const n = mesh.v.length / 6; // 앞면 n개, 뒷면 n개 (같은 순서)
  const rows = { top: [], bottom: [] };
  let ymin = Infinity, ymax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < n; i++) {
    ymin = Math.min(ymin, mesh.v[i * 3 + 1]);
    ymax = Math.max(ymax, mesh.v[i * 3 + 1]);
  }
  for (let i = 0; i < mesh.v.length / 3; i++) {
    zmin = Math.min(zmin, mesh.v[i * 3 + 2]);
    zmax = Math.max(zmax, mesh.v[i * 3 + 2]);
  }
  for (let i = 0; i < n; i++) {
    const y = mesh.v[i * 3 + 1];
    const t = mesh.v[i * 3 + 2] - mesh.v[(i + n) * 3 + 2];
    if (y > ymax - 0.25 * (ymax - ymin)) rows.top.push(t);
    if (y < ymin + 0.25 * (ymax - ymin)) rows.bottom.push(t);
  }
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  assert.ok(avg(rows.top) < avg(rows.bottom) * 0.6, `top ${avg(rows.top)} bottom ${avg(rows.bottom)}`);
  close(zmax - zmin, 0.6 * (ymax - ymin), 0.05 * (ymax - ymin)); // 원이라 가로 = 세로
});

test("predictViews: 키 헤더로 호출하고 검사된 그림을 돌려준다", async () => {
  const cur = views(rect, rect);
  let sent;
  const fetchImpl = async (url, init) => {
    sent = init;
    return { ok: true, status: 200, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: wire(cur) }] }) };
  };
  const r = await predictViews({ apiKey: "sk-x", model: "m", pngBase64: "AAA", front: { width: 0.5, height: 0.5 }, fetchImpl });
  assert.equal(sent.headers["x-api-key"], "sk-x");
  assert.equal(r.depthRatio, 0.5);
  assert.equal(r.views.left.outline.length, 4);
});
