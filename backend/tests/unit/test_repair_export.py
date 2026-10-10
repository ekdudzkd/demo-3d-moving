import json

import numpy as np
import pytest
import trimesh

from app.export.build import to_glb
from app.export.collider import MAX_HULL_POINTS, build_collider
from app.mesh.repair import STEPS, Step, repair_file, repair_mesh
from mesh_ready_check import inspect_path


def colored(mesh, rgb=(200, 100, 50)):
    mesh.visual = trimesh.visual.ColorVisuals(
        mesh, vertex_colors=np.tile([*rgb, 255], (len(mesh.vertices), 1))
    )
    return mesh


def messy_mesh():
    """생성 모델 출력 흉내: 원점 중심, 크기 0.6, 떠 있는 조각, 중복 정점."""
    body = colored(trimesh.creation.icosphere(subdivisions=3, radius=0.3))
    chip = colored(trimesh.creation.icosphere(subdivisions=0, radius=0.02), (128, 128, 128))
    chip.apply_translation([0.5, 0.5, 0.0])
    mesh = trimesh.util.concatenate([body, chip])
    # 면마다 정점을 따로 만들어 중복 정점 생성
    tris = mesh.triangles.reshape(-1, 3)
    colors = np.repeat(np.asarray(mesh.visual.face_colors), 3, axis=0)
    out = trimesh.Trimesh(tris, np.arange(len(tris)).reshape(-1, 3), process=False)
    out.visual = trimesh.visual.ColorVisuals(out, vertex_colors=colors)
    return out


def test_repair_fixes_generation_artifacts():
    repaired, steps = repair_mesh(messy_mesh(), budget=50_000)
    names = [s["name"] for s in steps]
    assert names == [s.name for s in STEPS]
    applied = {s["name"] for s in steps if s["applied"]}
    assert {"merge_vertices", "remove_small_components", "center_and_ground"} <= applied

    last = steps[-1]["after"]
    assert last["connected_components"] == 1
    assert last["duplicate_vertices"] == 0
    assert last["centered"] and last["grounded"]
    assert abs(max(last["extents"]) - 1.0) < 1e-6
    assert all("before" in s and "after" in s for s in steps)
    assert repaired.visual.kind == "vertex"


def test_regressing_step_is_rolled_back():
    def destroy(m, _):
        m.update_faces(np.arange(5))
        return m

    mesh = colored(trimesh.creation.icosphere(subdivisions=2))
    repaired, steps = repair_mesh(mesh, 50_000, [Step("destroy", destroy)])
    assert steps[0]["rolled_back"] and "손실" in steps[0]["reason"]
    assert len(repaired.faces) == len(mesh.faces)


def test_crashing_step_is_rolled_back():
    def boom(m, _):
        raise ValueError("boom")

    mesh = colored(trimesh.creation.icosphere(subdivisions=1))
    _, steps = repair_mesh(mesh, 50_000, [Step("boom", boom)])
    assert steps[0]["rolled_back"] and "boom" in steps[0]["reason"]


def test_decimate_respects_budget_and_keeps_colors():
    mesh = colored(trimesh.creation.icosphere(subdivisions=5), (10, 200, 30))
    repaired, steps = repair_mesh(mesh, budget=2000)
    assert len(repaired.faces) <= 2000
    dec = next(s for s in steps if s["name"] == "decimate")
    assert dec["applied"]
    colors = np.asarray(repaired.visual.vertex_colors)[:, :3]
    assert (colors == [10, 200, 30]).all()


def test_repair_file_writes_outputs(tmp_path):
    raw = tmp_path / "raw.obj"
    messy_mesh().export(raw)
    out = repair_file(raw, tmp_path / "mesh", 50_000)
    assert (tmp_path / "mesh" / "repaired.ply").exists()
    assert json.loads((tmp_path / "mesh" / "repair_steps.json").read_text("utf-8"))
    assert out["inspect_repaired"]["grounded"]
    assert raw.exists()  # 원본 보존


def test_collider_convex_hull():
    mesh = trimesh.creation.icosphere(subdivisions=4, radius=0.5)
    c = build_collider(mesh)
    assert c["type"] == "convex_hull"
    pts = np.array(c["points"])
    assert 4 <= len(pts) <= MAX_HULL_POINTS
    assert np.all(np.abs(pts) <= 0.5 + 1e-6)
    assert c["hull_volume"] > 0.3  # 구 부피 0.52의 상당 부분


def test_collider_flat_falls_back_to_box():
    flat = trimesh.creation.box(extents=[1, 1, 1e-6])
    c = build_collider(flat)
    assert c["type"] == "bounding_box"
    assert c["box"]["half_extents"][0] == pytest.approx(0.5)
    assert c["box"]["half_extents"][2] == pytest.approx(0.01)  # 두께 하한


def test_glb_keeps_vertex_colors(tmp_path):
    src = tmp_path / "m.ply"
    colored(trimesh.creation.box()).export(src)
    to_glb(src, tmp_path / "m.glb")
    assert inspect_path(tmp_path / "m.glb").has_vertex_colors


def test_glb_has_material_normals_and_linear_colors(tmp_path):
    from app.export.glb import read_gltf_json, write_glb

    path = tmp_path / "m.glb"
    write_glb(colored(trimesh.creation.box(), (250, 200, 40)), path)
    gltf = read_gltf_json(path.read_bytes())
    prim = gltf["meshes"][0]["primitives"][0]
    assert "NORMAL" in prim["attributes"]
    mat = gltf["materials"][prim["material"]]
    assert mat["pbrMetallicRoughness"]["metallicFactor"] == 0.0
    # 단색 메시라 COLOR_0 accessor의 max가 곧 저장된 색. sRGB (250, 200, 40) → linear 약 (243, 147, 5)
    rgb = gltf["accessors"][prim["attributes"]["COLOR_0"]]["max"][:3]
    assert abs(rgb[0] - 243) <= 2 and abs(rgb[1] - 147) <= 2 and rgb[2] <= 6
    assert inspect_path(path).has_vertex_colors
