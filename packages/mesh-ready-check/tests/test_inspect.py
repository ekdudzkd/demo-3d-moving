import json

import numpy as np
import pytest
import trimesh
from PIL import Image

import meshes
from mesh_ready_check import Severity, Thresholds, inspect_mesh, inspect_path


def codes(report, severity=None):
    return {c.code for c in report.checks if severity is None or c.severity is severity}


def test_clean_box_is_usable_without_warnings():
    r = inspect_mesh(meshes.clean_box())
    assert r.is_usable
    assert r.warnings == []
    assert r.connected_components == 1
    assert r.open_boundary_edges == 0
    assert r.non_manifold_edges == 0
    assert r.centered and r.grounded and not r.below_floor
    assert r.has_vertex_colors


def test_report_dict_has_brief_fields():
    d = inspect_mesh(meshes.clean_sphere()).to_dict()
    for key in (
        "schema_version",
        "is_usable",
        "vertex_count",
        "face_count",
        "connected_components",
        "non_manifold_edges",
        "has_uv",
        "has_texture",
        "centered",
        "grounded",
        "warnings",
    ):
        assert key in d
    json.dumps(d)


def test_empty_mesh_is_error():
    r = inspect_mesh(trimesh.Trimesh())
    assert not r.is_usable
    assert "empty_mesh" in codes(r, Severity.ERROR)


def test_non_finite_vertices_is_error():
    mesh = meshes.clean_box()
    vertices = mesh.vertices.copy()
    vertices[0, 0] = np.nan
    r = inspect_mesh(trimesh.Trimesh(vertices, mesh.faces, process=False))
    assert "non_finite_vertices" in codes(r, Severity.ERROR)


def test_floating_piece_warns_but_usable():
    r = inspect_mesh(meshes.floating_piece())
    assert r.is_usable
    assert r.connected_components == 2
    assert r.small_components == 1
    assert "small_components" in codes(r, Severity.WARN)


def test_two_equal_parts_is_fragmented_error():
    r = inspect_mesh(meshes.two_halves())
    assert not r.is_usable
    assert "fragmented" in codes(r, Severity.ERROR)


def test_inverted_normals_detected():
    r = inspect_mesh(meshes.inverted_sphere())
    assert r.inverted_normals
    assert "inverted_normals" in codes(r, Severity.WARN)
    assert not inspect_mesh(meshes.clean_sphere()).inverted_normals


def test_mixed_winding_detected():
    r = inspect_mesh(meshes.mixed_winding())
    assert not r.winding_consistent
    assert "inconsistent_winding" in codes(r, Severity.WARN)


def test_non_manifold_edges_counted():
    r = inspect_mesh(meshes.non_manifold())
    assert r.non_manifold_edges == 1
    # 1 edge / 15 faces > 5% → ERROR
    assert "non_manifold" in codes(r, Severity.ERROR)


def test_paper_sheet_is_flat():
    assert "flat_geometry" in codes(inspect_mesh(meshes.paper_sheet()), Severity.WARN)


def test_below_floor_not_grounded():
    r = inspect_mesh(meshes.below_floor())
    assert not r.grounded and r.below_floor
    assert "not_grounded" in codes(r, Severity.WARN)


def test_off_center_detected():
    r = inspect_mesh(meshes.off_center())
    assert not r.centered
    assert "not_centered" in codes(r, Severity.WARN)


def test_duplicate_vertices_counted_but_topology_merged():
    r = inspect_mesh(meshes.duplicated_vertices())
    assert r.duplicate_vertices == 36 - 8
    assert r.connected_components == 1
    assert r.open_boundary_edges == 0


def test_face_budget():
    mesh = meshes.high_poly()
    assert "too_many_faces" in codes(inspect_mesh(mesh, Thresholds(face_budget=1000)))
    assert "too_many_faces" not in codes(inspect_mesh(mesh, Thresholds(face_budget=10_000)))


def test_open_boundary_detected():
    mesh = meshes.clean_box()
    opened = trimesh.Trimesh(mesh.vertices, mesh.faces[:-1], process=False)
    r = inspect_mesh(opened)
    assert r.open_boundary_edges == 3
    assert "open_boundary" in codes(r, Severity.WARN)


def test_long_edges_detected():
    mesh = meshes.clean_sphere()
    vertices = np.vstack([mesh.vertices, [[0.0, 30.0, 0.0]]])
    faces = np.vstack([mesh.faces, [[0, 1, len(vertices) - 1]]])
    r = inspect_mesh(trimesh.Trimesh(vertices, faces, process=False))
    assert r.long_edges > 0


def test_degenerate_face_detected():
    mesh = meshes.clean_box()
    faces = np.vstack([mesh.faces, [[0, 0, 1]]])
    r = inspect_mesh(trimesh.Trimesh(mesh.vertices, faces, process=False))
    assert r.degenerate_faces == 1


def test_wrong_scale():
    t = Thresholds(target_size=1.0)
    assert "wrong_scale" not in codes(inspect_mesh(meshes.clean_box(), t))
    big = meshes.clean_box()
    big.apply_scale(3.0)
    assert "wrong_scale" in codes(inspect_mesh(big, t))


def test_uncolored_mesh_warns():
    assert "no_color" in codes(inspect_mesh(meshes.uncolored_box()), Severity.WARN)


def test_glb_roundtrip_vertex_colors(tmp_path):
    path = tmp_path / "sphere.glb"
    meshes.clean_sphere().export(path)
    r = inspect_path(path)
    assert r.is_usable
    assert r.has_vertex_colors
    assert r.grounded and r.centered


def test_glb_textured_mesh_has_uv_and_texture(tmp_path):
    mesh = meshes.uncolored_box()
    uv = np.random.default_rng(0).random((len(mesh.vertices), 2))
    image = Image.new("RGB", (8, 8), (255, 0, 0))
    mesh.visual = trimesh.visual.TextureVisuals(uv=uv, image=image)
    path = tmp_path / "textured.glb"
    mesh.export(path)
    r = inspect_path(path)
    assert r.has_uv and r.has_texture
    assert "no_color" not in codes(r)


def test_obj_roundtrip(tmp_path):
    path = tmp_path / "box.obj"
    meshes.clean_box().export(path)
    r = inspect_path(path)
    assert r.face_count == 12
    assert r.connected_components == 1


@pytest.mark.parametrize("name", sorted(meshes.ALL))
def test_every_fixture_produces_serializable_report(name):
    json.dumps(inspect_mesh(meshes.ALL[name]()).to_dict())
