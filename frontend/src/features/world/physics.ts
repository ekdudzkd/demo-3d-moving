import type { Asset } from "../../types/domain";

export type ColliderSpec =
  | { kind: "hull"; points: Float32Array; count: number }
  | { kind: "box"; halfExtents: [number, number, number]; center: [number, number, number]; reason: string };

/**
 * 서버가 만든 충돌체 정의를 Rapier용으로 바꾼다.
 * convex hull이 없거나 평면에 가까우면 상자로 폴백 (D-009).
 */
export function chooseCollider(asset: Asset): ColliderSpec {
  const c = asset.collider;
  const box = (reason: string): ColliderSpec => ({
    kind: "box",
    halfExtents: c.box.half_extents.map((v) => Math.max(v, 0.01)) as [number, number, number],
    center: c.box.center as [number, number, number],
    reason,
  });
  if (c.type !== "convex_hull" || !c.points || c.points.length < 4) return box(c.reason || "convex hull 없음");
  if (!spansVolume(c.points)) return box("hull 점이 한 평면에 있음");
  return { kind: "hull", points: new Float32Array(c.points.flat()), count: c.points.length };
}

/** 점들이 부피를 갖는지 (4개 이상이 한 평면에 있지 않은지) */
export function spansVolume(points: number[][]): boolean {
  const [a] = points;
  for (let i = 1; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const u = sub(points[i], a);
      const v = sub(points[j], a);
      const n = cross(u, v);
      if (Math.hypot(...n) < 1e-9) continue;
      for (let k = j + 1; k < points.length; k++) {
        if (Math.abs(dot(n, sub(points[k], a))) > 1e-6) return true;
      }
    }
  }
  return false;
}

export interface Keys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

/** 카메라가 바라보는 방향(yaw) 기준 이동 방향. 정규화된 [x, z] */
export function moveDirection(keys: Keys, cameraYaw: number): [number, number] {
  const f = Number(keys.forward) - Number(keys.back);
  const s = Number(keys.right) - Number(keys.left);
  if (!f && !s) return [0, 0];
  // yaw = 0이면 카메라가 -Z를 본다
  const fx = -Math.sin(cameraYaw);
  const fz = -Math.cos(cameraYaw);
  const rx = Math.cos(cameraYaw);
  const rz = -Math.sin(cameraYaw);
  const x = fx * f + rx * s;
  const z = fz * f + rz * s;
  const len = Math.hypot(x, z);
  return [x / len, z / len];
}

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
