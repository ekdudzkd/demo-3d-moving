import test from "node:test";
import assert from "node:assert/strict";
import { flattenPaper, looksLikePhoto, segment, keepMain } from "../pipeline.js";

// 조명이 한쪽에서 비치는 회색 화이트보드(왼쪽 230 → 오른쪽 150) 위 검은 선 고리 + 보라색으로 칠한 원
function photo({ gradient = true, noise = true } = {}) {
  const W = 200;
  const H = 160;
  const data = new Uint8ClampedArray(W * H * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let v = gradient ? 230 - (80 * x) / W : 255;
      if (noise) v += rnd() * 6;
      let rgb = [v, v, v * 0.98];
      const r = Math.hypot(x - 70, y - 80);
      if (Math.abs(r - 40) < 3) rgb = [25, 25, 25]; // 고리 선
      if (Math.hypot(x - 150, y - 80) < 22) rgb = [130 * (v / 230), 70 * (v / 230), 170 * (v / 230)]; // 색칠한 원
      data.set([...rgb.map((c) => Math.max(0, Math.min(255, c))), 255], i);
    }
  return { width: W, height: H, data };
}
const px = (img, x, y) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));

test("사진처럼 테두리가 고르지 않으면 사진, 단색 배경 디지털 그림은 아님", () => {
  assert.equal(looksLikePhoto(photo()), true);
  assert.equal(looksLikePhoto(photo({ gradient: false, noise: false })), false);
});

test("밝기 고르게: 어두운 쪽 종이도 흰색, 선은 검게, 칠한 색은 남는다", () => {
  const out = flattenPaper(photo());
  for (const [x, y] of [[5, 5], [100, 150], [195, 10]]) assert.ok(Math.min(...px(out, x, y)) > 235, `paper ${x},${y} ${px(out, x, y)}`);
  assert.ok(Math.max(...px(out, 110, 80)) < 60, `line ${px(out, 110, 80)}`);
  const [r, g, b] = px(out, 150, 80);
  assert.ok(b > g + 40 && r > g + 20, `purple ${r},${g},${b}`);
});

test("밝기 고르게 한 사진은 분할에서 회색 판이 물체로 잡히지 않는다", () => {
  const seg = segment(flattenPaper(photo()));
  assert.ok(seg.coverage < 0.3, `coverage ${seg.coverage}`);
});

test("keepMain: 가장자리에 걸친 큰 배경보다 가운데 그림을 고른다", () => {
  const W = 40, m = new Uint8Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 30; x < W; x++) m[y * W + x] = 1; // 오른쪽 가장자리 배경 (400)
  for (let y = 10; y < 22; y++) for (let x = 8; x < 20; x++) m[y * W + x] = 1; // 가운데 그림 (144)
  const out = keepMain(m, W, W);
  assert.equal(out[15 * W + 12], 1);
  assert.equal(out[15 * W + 35], 0);
  // 가운데 덩어리가 너무 작으면 가장 큰 것
  const m2 = new Uint8Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 20; x < W; x++) m2[y * W + x] = 1;
  m2[15 * W + 5] = 1;
  assert.equal(keepMain(m2, W, W)[15 * W + 30], 1);
});
