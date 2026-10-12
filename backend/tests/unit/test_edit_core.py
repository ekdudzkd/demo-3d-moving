"""5-1 편집 코어: 패널 기준표, 라벨 회전, 합성, stand_up, 범위·no-op 검사 (D-026·D-027)."""

import numpy as np
import pytest
import trimesh
from pydantic import TypeAdapter, ValidationError

from app.edit.basis import PANELS, label_rotation, screen_to_world
from app.edit.compose import apply, compose, extents_of, resolve
from app.edit.ops import (
    InvertLast,
    Mirror,
    Rotate90,
    ScaleAxis,
    ScaleUniform,
    ScreenOp,
    StandUp,
    linear,
)

FRONT = [{"op": "label", "label": "front"}]


def box(extents=(1.0, 1.0, 1.0)):
    return trimesh.creation.box(extents=extents)


def lying_cone(apex_sign=1):
    """원뿔을 x축으로 눕힌 것. 밑면이 -x(apex_sign=1) 또는 +x 쪽."""
    cone = trimesh.creation.cone(radius=0.2, height=1.0, sections=48)  # 축 z, 밑면 z=0
    to_x = trimesh.transformations.rotation_matrix(np.pi / 2 * apex_sign, [0, 1, 0])
    cone.apply_transform(to_x)
    return cone


def new_ops(res):
    assert res.kind == "ops", res.message
    return res.ops


# ---- 기준표 ----------------------------------------------------------------------


@pytest.mark.parametrize("panel", list(PANELS))
def test_panel_basis_is_right_handed(panel):
    p = PANELS[panel]
    assert np.allclose(np.cross(p["screen_right"], p["screen_up"]), p["toward_viewer"])


@pytest.mark.parametrize("label", list(PANELS))
def test_label_rotation_maps_image_axes_to_panel_axes(label):
    r = label_rotation(label)
    assert np.isclose(np.linalg.det(r), 1.0)
    p = PANELS[label]
    # 생성물은 입력 그림을 정면(+z에서 본 x·y)으로 가정한다 → 라벨 시점으로 옮김
    assert np.allclose(r @ [1, 0, 0], p["screen_right"])
    assert np.allclose(r @ [0, 1, 0], p["screen_up"])
    assert np.allclose(r @ [0, 0, 1], p["toward_viewer"])


def test_front_label_is_identity():
    assert np.allclose(label_rotation("front"), np.eye(3))


# ---- 6패널 × op 매트릭스 ------------------------------------------------------------


def world_op(panel, sop):
    res = resolve([sop], panel, FRONT, box((1.0, 0.8, 0.6)))
    (op,) = new_ops(res)
    return op


@pytest.mark.parametrize("panel", list(PANELS))
def test_rotate_toward_viewer_is_counterclockwise_on_screen(panel):
    p = PANELS[panel]
    m = linear(world_op(panel, Rotate90(axis="toward_viewer", k=1)))
    assert np.allclose(m @ p["screen_right"], p["screen_up"])
    assert np.allclose(m @ p["toward_viewer"], p["toward_viewer"])


@pytest.mark.parametrize("panel", list(PANELS))
def test_rotate_about_screen_axes_follows_right_hand_rule(panel):
    p = PANELS[panel]
    m = linear(world_op(panel, Rotate90(axis="screen_up", k=1)))
    assert np.allclose(m @ p["toward_viewer"], p["screen_right"])
    m = linear(world_op(panel, Rotate90(axis="screen_right", k=1)))
    assert np.allclose(m @ p["screen_up"], p["toward_viewer"])
    m = linear(world_op(panel, Rotate90(axis="screen_right", k=-1)))
    assert np.allclose(m @ p["toward_viewer"], p["screen_up"])


@pytest.mark.parametrize("panel", list(PANELS))
@pytest.mark.parametrize("axis", ["screen_right", "screen_up", "toward_viewer"])
def test_scale_axis_stretches_that_screen_direction(panel, axis):
    v0 = box((1.0, 0.8, 0.6))
    op = world_op(panel, ScaleAxis(axis=axis, factor=2.0))
    out = apply(v0, FRONT + [op])
    i = int(np.argmax(np.abs(screen_to_world(panel, axis))))
    expected = np.array(v0.extents)
    expected[i] *= 2
    assert np.allclose(out.extents, expected)


@pytest.mark.parametrize("panel", list(PANELS))
@pytest.mark.parametrize("axis", ["screen_right", "screen_up", "toward_viewer"])
def test_mirror_flips_that_screen_direction(panel, axis):
    m = linear(world_op(panel, Mirror(axis=axis)))
    d = screen_to_world(panel, axis)
    assert np.allclose(m @ d, -d)
    assert np.isclose(np.linalg.det(m), -1)


@pytest.mark.parametrize("panel", list(PANELS))
def test_uniform_scale_is_panel_independent(panel):
    m = linear(world_op(panel, ScaleUniform(factor=1.5)))
    assert np.allclose(m, np.eye(3) * 1.5)


# ---- 합성·적용 -------------------------------------------------------------------


def test_compose_applies_ops_in_order():
    ops = [
        {"op": "scale", "factors": [2.0, 1.0, 1.0]},
        {"op": "rotate", "axis": "z", "k": 1},
    ]
    # x로 2배 늘린 뒤 z축 90° → 늘어난 방향이 y
    assert np.allclose(compose(ops) @ [1, 0, 0], [0, 2, 0])
    v0 = box()
    assert np.allclose(apply(v0, ops).extents, extents_of(np.array(v0.extents), compose(ops)))


def test_result_is_grounded_and_centered():
    v0 = box((1.0, 0.5, 0.3))
    v0.apply_translation([3.0, -2.0, 1.0])
    out = apply(v0, [{"op": "label", "label": "left"}, {"op": "rotate", "axis": "x", "k": 1}])
    lo, hi = out.bounds
    assert np.isclose(lo[1], 0.0)
    assert np.allclose([(lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2], 0.0)


def test_mirror_keeps_winding_and_positive_volume():
    v0 = box((1.0, 0.5, 0.3))
    out = apply(v0, FRONT + [{"op": "mirror", "axis": "x"}])
    assert out.is_winding_consistent
    assert out.volume > 0
    assert np.isclose(out.volume, v0.volume)


def test_v0_is_not_modified():
    v0 = box()
    before = np.array(v0.vertices)
    apply(v0, FRONT + [{"op": "scale", "factors": [2, 3, 4]}])
    assert np.array_equal(v0.vertices, before)


def test_texture_uv_and_normals_survive_mirror_and_scale():
    v0 = box((1.0, 0.6, 0.4))
    uv = np.random.default_rng(0).random((len(v0.vertices), 2))
    image = trimesh.visual.material.SimpleMaterial()
    v0.visual = trimesh.visual.TextureVisuals(uv=uv, material=image)
    ops = FRONT + [{"op": "mirror", "axis": "z"}, {"op": "scale", "factors": [1.0, 3.0, 1.0]}]
    out = apply(v0, ops)
    assert np.array_equal(out.visual.uv, uv)
    assert np.allclose(np.linalg.norm(out.vertex_normals, axis=1), 1.0)
    assert np.allclose(np.linalg.norm(out.face_normals, axis=1), 1.0)
    assert out.volume > 0


def test_vertex_colors_survive():
    v0 = box()
    colors = np.tile([200, 100, 50, 255], (len(v0.vertices), 1)).astype(np.uint8)
    v0.visual = trimesh.visual.ColorVisuals(v0, vertex_colors=colors)
    out = apply(v0, FRONT + [{"op": "mirror", "axis": "y"}])
    assert np.array_equal(out.visual.vertex_colors, colors)


# ---- stand_up -------------------------------------------------------------------


@pytest.mark.parametrize("apex_sign", [1, -1])
def test_stand_up_puts_heavy_end_down(apex_sign):
    v0 = lying_cone(apex_sign)
    ops = FRONT + new_ops(resolve([StandUp()], "front", FRONT, v0))
    out = apply(v0, ops)
    assert np.argmax(out.extents) == 1  # 가장 긴 축이 위
    tri_y = out.triangles_center[:, 1]
    # 원뿔 밑면(넓은 쪽)이 바닥 → 면적 대부분이 아래 절반
    low = out.area_faces[tri_y < out.extents[1] / 2].sum()
    assert low > out.area / 2


def test_stand_up_symmetric_rod_picks_plus_with_note():
    v0 = trimesh.creation.cylinder(radius=0.05, height=1.0, sections=24)
    v0.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0]))
    res = resolve([StandUp()], "front", FRONT, v0)
    assert new_ops(res) == [{"op": "rotate", "axis": "z", "k": 1}]
    assert any("뒤집어줘" in n for n in res.notes)


def test_stand_up_along_z_uses_x_axis():
    v0 = box((0.3, 0.3, 1.0))
    (op,) = new_ops(resolve([StandUp()], "front", FRONT, v0))
    assert op["axis"] == "x"
    assert np.argmax(apply(v0, FRONT + [op]).extents) == 1


def test_stand_up_when_already_standing_is_noop():
    res = resolve([StandUp()], "front", FRONT, box((0.3, 1.0, 0.3)))
    assert res.kind == "noop"
    assert "이미 서 있어요" in res.message


def test_stand_up_uses_active_version_not_v0():
    v0 = box((1.0, 0.3, 0.3))  # 누워 있음
    active = FRONT + [{"op": "rotate", "axis": "z", "k": 1}]  # 이미 세움
    assert resolve([StandUp()], "front", active, v0).kind == "noop"


# ---- invert_last ----------------------------------------------------------------


def test_invert_last_undoes_previous_user_op():
    v0 = box()
    active = FRONT + [{"op": "scale", "factors": [2.0, 1.0, 1.0]}]
    ops = new_ops(resolve([InvertLast()], "back", active, v0))
    assert ops == [{"op": "scale", "factors": [0.5, 1.0, 1.0]}]
    assert np.allclose(compose(active + ops), np.eye(3))


def test_invert_last_rotation_and_mirror():
    v0 = box()
    for last in ({"op": "rotate", "axis": "y", "k": 1}, {"op": "mirror", "axis": "z"}):
        ops = new_ops(resolve([InvertLast()], "front", FRONT + [last], v0))
        assert np.allclose(compose([last] + ops), np.eye(3))


def test_invert_last_without_user_op_is_refused():
    res = resolve([InvertLast()], "front", FRONT, box())
    assert (res.kind, res.reason_code) == ("refuse", "nothing_to_invert")


# ---- 범위·no-op ------------------------------------------------------------------


def test_cumulative_scale_beyond_limit_is_refused():
    v0 = box()
    active = FRONT + [{"op": "scale", "factors": [5.0, 5.0, 5.0]}]
    res = resolve([ScaleUniform(factor=3.0)], "front", active, v0)
    assert (res.kind, res.reason_code) == ("refuse", "out_of_range")
    assert "5.00" in res.message


def test_cumulative_shrink_beyond_limit_is_refused():
    active = FRONT + [{"op": "scale", "factors": [1.0, 1.0, 0.2]}]
    res = resolve([ScaleAxis(axis="toward_viewer", factor=0.4)], "front", active, box())
    assert res.reason_code == "out_of_range"


def test_factor_is_measured_in_object_frame_after_rotation():
    # x로 4배 → z축 회전(늘어난 축이 y) → y로 3배 = 물체 x축 누적 12배 → 거절
    active = FRONT + [
        {"op": "scale", "factors": [4.0, 1.0, 1.0]},
        {"op": "rotate", "axis": "z", "k": 1},
    ]
    res = resolve([ScaleAxis(axis="screen_up", factor=3.0)], "front", active, box())
    assert res.reason_code == "out_of_range"


def test_extreme_aspect_ratio_is_refused():
    v0 = box((1.0, 1.0, 0.2))  # 비율 5
    res = resolve([ScaleAxis(axis="screen_right", factor=5.0)], "front", FRONT, v0)
    assert res.reason_code == "out_of_range"


def test_already_thin_e0_still_allows_rotation_and_thickening():
    v0 = box((1.0, 1.0, 0.03))  # 비율 33 > 20
    assert resolve([Rotate90(axis="screen_up", k=1)], "front", FRONT, v0).kind == "ops"
    assert resolve([ScaleAxis(axis="toward_viewer", factor=2.0)], "front", FRONT, v0).kind == "ops"
    res = resolve([ScaleAxis(axis="toward_viewer", factor=0.5)], "front", FRONT, v0)
    assert res.reason_code == "out_of_range"


def test_ops_that_cancel_out_are_noop():
    v0 = box()
    assert resolve([Mirror(axis="screen_right")] * 2, "front", FRONT, v0).kind == "noop"
    assert resolve([Rotate90(axis="screen_up", k=2)] * 2, "front", FRONT, v0).kind == "noop"
    assert resolve([ScaleUniform(factor=1.0)], "front", FRONT, v0).kind == "noop"


# ---- 스키마 ---------------------------------------------------------------------


def test_screen_op_schema_parses_and_rejects():
    ta = TypeAdapter(list[ScreenOp])
    ops = ta.validate_python(
        [{"type": "rotate90", "axis": "toward_viewer", "k": -1}, {"type": "stand_up"}]
    )
    assert isinstance(ops[0], Rotate90) and isinstance(ops[1], StandUp)
    for bad in (
        {"type": "rotate90", "axis": "screen_up", "k": 0},
        {"type": "rotate90", "axis": "screen_up", "k": 4},
        {"type": "scale_axis", "axis": "screen_up", "factor": 20},
        {"type": "scale_uniform", "factor": 0},
        {"type": "mirror", "axis": "diagonal"},
        {"type": "scale_axis", "axis": "screen_up", "factor": 2, "target": "ears"},
        {"type": "shear"},
    ):
        with pytest.raises(ValidationError):
            ta.validate_python([bad])
