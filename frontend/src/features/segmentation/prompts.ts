export type Mode = "positive" | "negative" | "box";

export interface PromptPoint {
  x: number;
  y: number;
  label: 0 | 1;
}

export interface Prompts {
  points: PromptPoint[];
  box: [number, number, number, number] | null;
}

export const EMPTY: Prompts = { points: [], box: null };

/** 화면 좌표 → 원본 이미지 픽셀 좌표 */
export function toImageCoords(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  imageW: number,
  imageH: number,
): { x: number; y: number } {
  const x = ((clientX - rect.left) / rect.width) * imageW;
  const y = ((clientY - rect.top) / rect.height) * imageH;
  return { x: clamp(Math.round(x), 0, imageW - 1), y: clamp(Math.round(y), 0, imageH - 1) };
}

export function normalizeBox(a: { x: number; y: number }, b: { x: number; y: number }): [number, number, number, number] {
  return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
}

export function isUsableBox(box: [number, number, number, number], imageW: number): boolean {
  const min = Math.max(8, imageW * 0.02);
  return box[2] - box[0] >= min && box[3] - box[1] >= min;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
