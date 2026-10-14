import test from "node:test";
import assert from "node:assert/strict";
import { TEMPLATES, estimateJoints, computeSkin, fitAffine, chooseTemplate, linesOf } from "../rig.js";

const S = 128;
function paint(shapes) {
  const m = new Uint8Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++)
      for (const s of shapes) {
        if (s.r ? Math.hypot(x - s.cx, y - s.cy) <= s.r : x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1) m[y * S + x] = 1;
      }
  return m;
}
// 사람: 머리 원, 몸통, 몸과 4px 떨어진 두 팔, 두 다리
const human = paint([
  { cx: 64, cy: 20, r: 12 },
  { x0: 60, x1: 68, y0: 30, y1: 36 },
  { x0: 50, x1: 78, y0: 34, y1: 74 },
  { x0: 38, x1: 45, y0: 36, y1: 80 },
  { x0: 46, x1: 50, y0: 36, y1: 40 },
  { x0: 83, x1: 90, y0: 36, y1: 80 },
  { x0: 78, x1: 82, y0: 36, y1: 40 },
  { x0: 52, x1: 61, y0: 72, y1: 120 },
  { x0: 67, x1: 76, y0: 72, y1: 120 },
]);
const px = (j) => [j[0] * S, j[1] * S];

test("사람형 관절 어림: 머리·발·손이 제자리 근처", () => {
  const J = estimateJoints(human, S, "human");
  for (const k of TEMPLATES.human.joints) assert.ok(J[k], k);
  const [hx, hy] = px(J.head);
  assert.ok(Math.abs(hx - 64) < 4 && hy < 30, `head ${hx},${hy}`);
  assert.ok(Math.abs(px(J.fL)[0] - 56.5) < 4 && px(J.fL)[1] > 112, `fL ${px(J.fL)}`);
  assert.ok(Math.abs(px(J.fR)[0] - 71.5) < 4, `fR ${px(J.fR)}`);
  assert.ok(px(J.hL)[0] < 47 && px(J.hR)[0] > 81, `hands ${px(J.hL)} ${px(J.hR)}`);
  assert.ok(px(J.neck)[1] > 26 && px(J.neck)[1] < 40, `neck ${px(J.neck)}`);
  assert.ok(px(J.hip)[1] > 60 && px(J.hip)[1] < 76, `hip ${px(J.hip)}`);
});

// 그림 위 점을 정점 하나로 보고 어느 뼈에 붙는지 본다
function boneAt(J, points) {
  const uv = new Float32Array(points.flatMap(([x, y]) => [(x + 0.5) / S, 1 - (y + 0.5) / S]));
  const s = computeSkin({ uv, mask: human, S, joints: J, templateId: "human", G: 128 });
  return points.map((_, i) => s.bones[s.skinIndex[i * 4]]);
}

test("가중치: 발은 정강이, 머리는 머리, 아래팔은 아래팔 뼈", () => {
  const J = estimateJoints(human, S, "human");
  const [foot, head, forearm, shin2] = boneAt(J, [[56, 117], [64, 12], [41, 76], [71, 117]]);
  assert.equal(foot, "shL");
  assert.equal(head, "head");
  assert.equal(forearm, "faL");
  assert.equal(shin2, "shR");
});

test("가중치: 몸과 떨어진 팔 정점이 몸통 뼈에 끌려가지 않는다(지오데식)", () => {
  const J = estimateJoints(human, S, "human");
  const [armMid, torso] = boneAt(J, [[41, 58], [64, 50]]);
  assert.ok(armMid === "uaL" || armMid === "faL", armMid);
  assert.ok(torso === "chest" || torso === "root", torso);
});

test("가중치 합은 1, 정점당 4칸", () => {
  const J = estimateJoints(human, S, "human");
  const uv = new Float32Array([0.5, 0.5, 0.3, 0.2, 0.99, 0.01]);
  const s = computeSkin({ uv, mask: human, S, joints: J, templateId: "human" });
  assert.equal(s.skinIndex.length, 12);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(s.skinWeight[i * 4] + s.skinWeight[i * 4 + 1] - 1) < 1e-6);
});

test("UV → 메시 좌표 근사: 돌출 판의 앞·뒤 가운데", () => {
  const uv = [];
  const pos = [];
  for (const [u, v] of [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9], [0.5, 0.3]])
    for (const z of [-0.05, 0.05]) {
      uv.push(u, v);
      pos.push(u - 0.5, v * 2, z);
    }
  const f = fitAffine(Float32Array.from(uv), Float32Array.from(pos));
  const [x, y, z] = f(0.5, 0.25); // iy=0.25 → v=0.75
  assert.ok(Math.abs(x) < 1e-6 && Math.abs(y - 1.5) < 1e-6 && Math.abs(z) < 1e-6);
});

// 네발 동물(옆모습): 머리가 오른쪽
const horse = paint([
  { x0: 30, x1: 92, y0: 50, y1: 76 },
  { x0: 88, x1: 100, y0: 30, y1: 55 },
  { cx: 104, cy: 30, r: 8 },
  { x0: 22, x1: 30, y0: 52, y1: 58 },
  { x0: 34, x1: 39, y0: 76, y1: 110 },
  { x0: 44, x1: 49, y0: 76, y1: 110 },
  { x0: 76, x1: 81, y0: 76, y1: 110 },
  { x0: 86, x1: 91, y0: 76, y1: 110 },
]);

test("네발 관절 어림: 머리는 높은 쪽, 앞다리는 머리 쪽", () => {
  const J = estimateJoints(horse, S, "quad");
  for (const k of TEMPLATES.quad.joints) assert.ok(J[k], k);
  assert.ok(px(J.head)[0] > 95, `head ${px(J.head)}`);
  assert.ok(px(J.fls)[0] > 70 && px(J.hls)[0] < 55, `legs ${px(J.fls)} ${px(J.hls)}`);
  assert.ok(px(J.tail)[0] < 30, `tail ${px(J.tail)}`);
  assert.ok(px(J.flf)[1] > 100);
});

test("기본 틀: 세로로 긴 그림은 사람형, 그 외는 관절 없음", () => {
  assert.equal(chooseTemplate(human, S), "human");
  assert.equal(chooseTemplate(horse, S), "none");
  assert.ok(linesOf(TEMPLATES.human).length >= 15);
});

test("네발: 앞다리 둘·뒷다리 둘이 붙어 한 덩어리여도 네 다리로 나눈다", () => {
  const fused = paint([
    { x0: 30, x1: 92, y0: 50, y1: 76 },
    { x0: 88, x1: 100, y0: 30, y1: 55 },
    { cx: 104, cy: 30, r: 8 },
    { x0: 34, x1: 49, y0: 76, y1: 110 },
    { x0: 76, x1: 91, y0: 76, y1: 110 },
  ]);
  const J = estimateJoints(fused, S, "quad");
  const xs = ["fls", "frs", "hls", "hrs"].map((k) => px(J[k])[0]);
  assert.ok(Math.abs(xs[0] - xs[1]) > 4, `front ${xs}`);
  assert.ok(Math.abs(xs[2] - xs[3]) > 4, `hind ${xs}`);
  assert.ok(Math.min(xs[0], xs[1]) > 74 && Math.max(xs[2], xs[3]) < 51, `${xs}`);
});
