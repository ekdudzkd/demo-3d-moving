import { describe, expect, it } from "vitest";

import { alphaToMask, maskEdges } from "../src/features/segmentation/maskRender";
import { isUsableBox, normalizeBox, toImageCoords } from "../src/features/segmentation/prompts";

describe("prompts", () => {
  it("화면 좌표를 원본 픽셀 좌표로 바꾼다", () => {
    const rect = { left: 100, top: 50, width: 500, height: 500 };
    expect(toImageCoords(350, 300, rect, 1000, 1000)).toEqual({ x: 500, y: 500 });
    expect(toImageCoords(0, 0, rect, 1000, 1000)).toEqual({ x: 0, y: 0 });
    expect(toImageCoords(9999, 9999, rect, 1000, 800)).toEqual({ x: 999, y: 799 });
  });

  it("드래그 방향과 무관하게 상자를 만든다", () => {
    expect(normalizeBox({ x: 10, y: 50 }, { x: 5, y: 20 })).toEqual([5, 20, 10, 50]);
  });

  it("너무 작은 상자는 무시한다", () => {
    expect(isUsableBox([0, 0, 5, 5], 1000)).toBe(false);
    expect(isUsableBox([0, 0, 100, 100], 1000)).toBe(true);
  });
});

describe("maskRender", () => {
  it("경계 픽셀만 표시한다", () => {
    // 5×5 중 가운데 3×3이 전경
    const m = new Uint8Array(25);
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) m[y * 5 + x] = 1;
    const e = maskEdges(m, 5, 5);
    expect(e[2 * 5 + 2]).toBe(0); // 중심은 내부
    expect(e[1 * 5 + 1]).toBe(1);
    expect(Array.from(e).reduce((a, b) => a + b, 0)).toBe(8);
  });

  it("RGBA에서 마스크를 읽는다", () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 200, 200, 200, 255]);
    expect(Array.from(alphaToMask(rgba))).toEqual([1, 0, 1]);
  });
});
