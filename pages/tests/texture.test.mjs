// 얼굴 같은 가는 디테일: 점 색 대신 텍스처(UV)로 입힌다. UV가 보정 단계를 지나도 정점과 같이 가는지 검사.
import assert from "node:assert/strict";
import { test } from "node:test";

import { TEX_SIZE, generateMesh, repairMesh, segment } from "../pipeline.js";

// 96×96: 흰 배경, 가운데 빨간 정사각형, 그 안에 파란 점(작은 디테일)
function picture() {
  const W = 96;
  const data = new Uint8ClampedArray(W * W * 4).fill(255);
  for (let y = 24; y < 72; y++) {
    for (let x = 24; x < 72; x++) data.set([220, 40, 40, 255], (y * W + x) * 4);
  }
  for (let y = 46; y < 50; y++) {
    for (let x = 46; x < 50; x++) data.set([20, 40, 230, 255], (y * W + x) * 4);
  }
  return { width: W, height: W, data };
}

test("메시의 모든 정점에 [0,1] 범위 UV가 있다", () => {
  const gen = generateMesh(segment(picture()), { artifacts: true, seed: 1 });
  assert.equal(gen.mesh.uv.length, (gen.mesh.v.length / 3) * 2);
  for (const t of gen.mesh.uv) assert.ok(t >= -1e-6 && t <= 1 + 1e-6, `uv ${t}`);
});

test("자동 보정(병합·감소·크기 정규화)을 지나도 UV가 정점 수와 맞는다", () => {
  const gen = generateMesh(segment(picture()), { artifacts: true, seed: 1 });
  const rep = repairMesh(gen.mesh, 300);
  assert.ok(rep.mesh.uv, "보정 메시에 uv가 있어야 한다");
  assert.equal(rep.mesh.uv.length, (rep.mesh.v.length / 3) * 2);
  assert.ok(rep.mesh.f.length / 3 <= 300 + 12, "면 예산 근처로 줄어든다");
});

test("텍스처는 원본 디테일을 그대로 갖고, 윤곽선 밖은 안쪽 색으로 채운다", () => {
  const gen = generateMesh(segment(picture()), { artifacts: false });
  const { size, data } = gen.texture;
  assert.equal(size, TEX_SIZE);
  const px = (x, y) => [...data.subarray((y * size + x) * 4, (y * size + x) * 4 + 3)];
  const dot = px(size / 2, size / 2);
  assert.ok(dot[2] > 150 && dot[0] < 100, `파란 점이 남아야 한다: ${dot}`);
  const outside = px(5, 5); // 흰 배경 → 가장 가까운 안쪽(빨강 계열) 색으로 채워짐
  assert.ok(outside[0] > outside[2], `배경 쪽은 안쪽 색으로 번져야 한다: ${outside}`);
});
