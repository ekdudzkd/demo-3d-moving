import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { qualityRows } from "../src/features/quality-report/quality";
import { applyViewOptions } from "../src/three/ModelView";
import type { InspectReport } from "../src/types/domain";

const report = (over: Partial<InspectReport> = {}): InspectReport => ({
  is_usable: true,
  vertex_count: 1000,
  face_count: 2000,
  connected_components: 1,
  small_components: 0,
  open_boundary_edges: 0,
  non_manifold_edges: 0,
  duplicate_vertices: 0,
  degenerate_faces: 0,
  has_uv: false,
  has_texture: false,
  has_vertex_colors: true,
  extents: [1, 0.5, 0.25],
  centered: true,
  grounded: true,
  errors: [],
  warnings: [],
  ...over,
});

describe("qualityRows", () => {
  it("원본과 보정본을 나란히, 보정본 기준으로 OK 판정", () => {
    const rows = qualityRows(report({ connected_components: 2, small_components: 1, grounded: false }), report());
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.connected_components).toMatchObject({ raw: "2", repaired: "1", ok: true });
    expect(by.grounded).toMatchObject({ raw: "아니오", repaired: "예", ok: true });
    expect(by.face_count.ok).toBeNull();
    expect(by.extents.repaired).toBe("1.00 × 0.50 × 0.25");
    expect(by.color.repaired).toBe("정점 색");
  });

  it("사용 불가면 표시", () => {
    const by = Object.fromEntries(qualityRows(report(), report({ is_usable: false })).map((r) => [r.key, r]));
    expect(by.is_usable.ok).toBe(false);
  });
});

describe("applyViewOptions", () => {
  it("와이어프레임·색 끄기·되돌리기", () => {
    const tex = new THREE.Texture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true });
    const root = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(), mat));
    applyViewOptions(root, { wireframe: true, colors: false });
    expect(mat.wireframe).toBe(true);
    expect(mat.map).toBeNull();
    expect(mat.vertexColors).toBe(false);
    applyViewOptions(root, { wireframe: false, colors: true });
    expect(mat.map).toBe(tex);
    expect(mat.vertexColors).toBe(true);
  });
});
