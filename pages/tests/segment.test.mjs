import assert from "node:assert/strict";
import { test } from "node:test";
import { hysteresisMask } from "../pipeline.js";

// 8x8 거리 맵: 가운데 진한 덩어리(100) + 붙어 있는 연한 띠(20) + 떨어져 있는 연한 얼룩(20)
function map() {
  const S = 8;
  const d = new Float32Array(S * S);
  d[3 * S + 3] = 100;
  d[3 * S + 4] = 20; // 진한 부분에 붙은 연한 픽셀
  d[3 * S + 5] = 20;
  d[7 * S + 0] = 20; // 떨어진 얼룩
  return { d, S };
}

test("연한 부분은 진한 부분에 이어져 있을 때만 전경이 된다", () => {
  const { d, S } = map();
  const m = hysteresisMask(d, S, 10, 50);
  assert.equal(m[3 * S + 3], 1);
  assert.equal(m[3 * S + 4], 1);
  assert.equal(m[3 * S + 5], 1);
  assert.equal(m[7 * S + 0], 0);
});

test("낮은 임계값이 높은 임계값과 같으면 높은 임계값만 쓴다", () => {
  const { d, S } = map();
  const m = hysteresisMask(d, S, 50, 50);
  assert.equal(m.reduce((a, b) => a + b, 0), 1);
});
