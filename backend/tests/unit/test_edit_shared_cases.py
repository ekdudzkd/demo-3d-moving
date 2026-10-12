"""5-5 교차 언어 케이스: pages/edit.js와 같은 fixtures/edit_cases.json을 Python 구현으로 검사한다."""

import json
from pathlib import Path

import numpy as np
import pytest
import trimesh
from pydantic import TypeAdapter

from app.edit.compose import apply, compose, resolve
from app.edit.ops import ScreenOp

SHARED = json.loads((Path(__file__).parents[1] / "fixtures/edit_cases.json").read_text("utf-8"))
OPS = TypeAdapter(list[ScreenOp])


def mesh(name: str) -> trimesh.Trimesh:
    m = SHARED["meshes"][name]
    return trimesh.Trimesh(np.asarray(m["v"], dtype=float), np.asarray(m["f"]), process=False)


@pytest.mark.parametrize("label, matrix", SHARED["label_matrices"].items())
def test_label_matrix(label, matrix):
    np.testing.assert_array_equal(compose([{"op": "label", "label": label}]), matrix)


@pytest.mark.parametrize("case", SHARED["resolve"], ids=[c["name"] for c in SHARED["resolve"]])
def test_resolve(case):
    v0 = mesh(case["mesh"])
    res = resolve(OPS.validate_python(case["screen_ops"]), case["panel"], case["active_ops"], v0)
    assert res.kind == case["kind"]
    assert res.message == case["message"]
    if res.kind == "ops":
        assert res.ops == case["ops"]
        assert len(res.notes) == case["notes"]
        out = apply(v0, case["active_ops"] + res.ops)
        np.testing.assert_allclose(out.extents, case["extents"], atol=1e-6)
        assert out.bounds[0][1] == pytest.approx(0, abs=1e-9)
    if res.kind == "refuse":
        assert res.reason_code == case["reason_code"]
