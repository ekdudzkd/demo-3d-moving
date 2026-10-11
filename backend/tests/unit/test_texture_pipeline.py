"""3-5: 면 감소와 텍스처 GLB 내장."""

import json

import numpy as np
import trimesh
from PIL import Image

from app.export.build import to_glb
from app.export.glb import read_gltf_json
from app.mesh.repair import repair_file
from mesh_ready_check import load_mesh


def textured_sphere(count: int) -> trimesh.Trimesh:
    """구면 좌표 UV와 가로 줄무늬 텍스처를 가진 구."""
    m = trimesh.creation.uv_sphere(radius=0.5, count=[count, count])
    v = m.vertices / np.linalg.norm(m.vertices, axis=1, keepdims=True)
    uv = np.column_stack([0.5 + np.arctan2(v[:, 2], v[:, 0]) / (2 * np.pi), 0.5 + v[:, 1] / 2])
    tex = np.zeros((64, 64, 3), np.uint8)
    tex[:32] = (220, 40, 40)  # 위쪽 절반(v 큼) 빨강
    tex[32:] = (40, 90, 220)  # 아래쪽 절반 파랑
    m.visual = trimesh.visual.TextureVisuals(
        uv=uv, material=trimesh.visual.material.SimpleMaterial(image=Image.fromarray(tex))
    )
    return m


def gltf_of(path):
    return read_gltf_json(path.read_bytes())


def test_100k_textured_mesh_reduced_under_budget_keeps_color(tmp_path):
    mesh = textured_sphere(226)
    assert len(mesh.faces) >= 100_000
    raw = tmp_path / "raw.glb"
    mesh.export(raw)

    out = repair_file(raw, tmp_path / "mesh", face_budget=50_000)
    repaired, _ = load_mesh(out["repaired_path"])
    assert len(repaired.faces) <= 50_000
    steps = {s["name"]: s for s in out["steps"]}
    assert steps["decimate"]["applied"]
    # UV는 감소에서 보존되지 않아 텍스처 색을 정점 색으로 옮긴다: 위쪽은 빨강, 아래쪽은 파랑
    colors = np.asarray(repaired.visual.vertex_colors)[:, :3].astype(int)
    top = repaired.vertices[:, 1] > np.percentile(repaired.vertices[:, 1], 90)
    bottom = repaired.vertices[:, 1] < np.percentile(repaired.vertices[:, 1], 10)
    assert colors[top, 0].mean() > colors[top, 2].mean() + 80
    assert colors[bottom, 2].mean() > colors[bottom, 0].mean() + 80


def test_textured_mesh_within_budget_embeds_texture_in_glb(tmp_path):
    mesh = textured_sphere(48)
    assert len(mesh.faces) < 50_000
    raw = tmp_path / "raw.glb"
    mesh.export(raw)

    out = repair_file(raw, tmp_path / "mesh", face_budget=50_000)
    assert out["repaired_path"].endswith(".glb")
    assert out["inspect_repaired"]["has_texture"] and out["inspect_repaired"]["has_uv"]

    glb = tmp_path / "repaired_export.glb"
    to_glb(tmp_path / "mesh" / "repaired.glb", glb)
    gltf = gltf_of(glb)
    assert len(gltf["images"]) == 1 and gltf["textures"]
    prim = gltf["meshes"][0]["primitives"][0]
    assert "TEXCOORD_0" in prim["attributes"]
    pbr = gltf["materials"][prim["material"]]["pbrMetallicRoughness"]
    assert "baseColorTexture" in pbr
    assert pbr["metallicFactor"] == 0.0  # 금속 기본값(1.0)이면 웹 뷰어에서 어둡게 보임
    reloaded, info = load_mesh(glb)
    assert info.has_texture and info.has_uv
    assert len(reloaded.faces) == len(mesh.faces)


def test_vertex_color_glb_has_single_material_and_no_empty_arrays(tmp_path):
    box = trimesh.creation.box()
    box.visual = trimesh.visual.ColorVisuals(box, vertex_colors=[200, 100, 50, 255])
    src = tmp_path / "box.ply"
    box.export(src)
    glb = tmp_path / "box.glb"
    to_glb(src, glb)
    gltf = gltf_of(glb)
    assert len(gltf["materials"]) == 1
    assert gltf["materials"][0]["pbrMetallicRoughness"]["metallicFactor"] == 0.0
    assert all(v != [] for v in gltf.values()), json.dumps(gltf)[:200]


def test_uv_islands_not_removed_as_small_components(tmp_path):
    """UV 섬마다 정점이 나뉜 텍스처 메시(xatlas 출력과 같은 형태)에서 면이 사라지지 않아야 한다."""
    base = textured_sphere(48)
    mesh = base.copy()
    mesh.unmerge_vertices()
    islands = np.repeat(np.arange(len(base.faces)) // 50, 3)  # 50면짜리 UV 섬 수십 개
    uv = base.visual.uv[base.faces].reshape(-1, 2) * 0.01 + (islands % 90)[:, None] * 0.011
    mesh.visual = trimesh.visual.TextureVisuals(
        uv=uv, material=trimesh.visual.material.SimpleMaterial(image=base.visual.material.image)
    )
    raw = tmp_path / "raw.glb"
    mesh.export(raw)

    out = repair_file(raw, tmp_path / "mesh", face_budget=50_000)
    steps = {s["name"]: s for s in out["steps"]}
    assert steps["remove_small_components"]["after"]["face_count"] == len(base.faces)
    assert out["inspect_repaired"]["face_count"] == len(base.faces)
    assert out["inspect_repaired"]["has_texture"]


def test_small_floating_piece_still_removed():
    from app.mesh.repair import remove_small_components

    body = trimesh.creation.icosphere(subdivisions=3)
    chip = trimesh.creation.box(extents=(0.05, 0.05, 0.05))
    chip.apply_translation([3, 0, 0])
    out = remove_small_components(trimesh.util.concatenate([body, chip]), 50_000)
    assert len(out.faces) == len(body.faces)
