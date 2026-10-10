import { describe, expect, it } from "vitest";

import { chooseCollider, moveDirection, spansVolume } from "../src/features/world/physics";
import type { Asset } from "../src/types/domain";

const cube = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 1, 1],
];

function asset(collider: Partial<Asset["collider"]>): Asset {
  return {
    asset_id: "a",
    display_name: "x",
    mesh_url: "/m.glb",
    raw_mesh_url: "/r.glb",
    scale: 1,
    spawn_position: [0, 1, 0],
    collision_type: "convex_hull",
    interaction_type: "movable",
    mass: 1,
    bounds: [
      [-0.5, 0, -0.5],
      [0.5, 1, 0.5],
    ],
    collider: {
      type: "convex_hull",
      points: cube,
      box: { center: [0, 0.5, 0], half_extents: [0.5, 0.5, 0.002] },
      sphere: { center: [0, 0.5, 0], radius: 0.8 },
      reason: "",
      ...collider,
    },
  };
}

describe("chooseCollider", () => {
  it("convex hull 점을 Float32Array로", () => {
    const s = chooseCollider(asset({}));
    expect(s.kind).toBe("hull");
    if (s.kind === "hull") {
      expect(s.count).toBe(5);
      expect(s.points.length).toBe(15);
    }
  });

  it("서버가 상자로 정했으면 상자 (두께 하한 적용)", () => {
    const s = chooseCollider(asset({ type: "bounding_box", points: null, reason: "납작" }));
    expect(s).toMatchObject({ kind: "box", reason: "납작" });
    if (s.kind === "box") expect(s.halfExtents[2]).toBeGreaterThanOrEqual(0.01);
  });

  it("평면 위 점들은 상자로 폴백", () => {
    const flat = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ];
    expect(chooseCollider(asset({ points: flat })).kind).toBe("box");
  });
});

it("spansVolume", () => {
  expect(spansVolume(cube)).toBe(true);
  expect(
    spansVolume([
      [0, 0, 0],
      [1, 1, 1],
      [2, 2, 2],
      [3, 3, 3],
    ]),
  ).toBe(false);
});

describe("moveDirection", () => {
  const none = { forward: false, back: false, left: false, right: false };
  it("키가 없으면 정지", () => expect(moveDirection(none, 0)).toEqual([0, 0]));
  it("카메라가 +Z에서 바라볼 때 W는 -Z", () => {
    const [x, z] = moveDirection({ ...none, forward: true }, 0);
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(-1);
  });
  it("D는 오른쪽(+X)", () => {
    const [x, z] = moveDirection({ ...none, right: true }, 0);
    expect(x).toBeCloseTo(1);
    expect(z).toBeCloseTo(0);
  });
  it("대각선은 정규화", () => {
    const [x, z] = moveDirection({ ...none, forward: true, right: true }, 0.7);
    expect(Math.hypot(x, z)).toBeCloseTo(1);
  });
});
