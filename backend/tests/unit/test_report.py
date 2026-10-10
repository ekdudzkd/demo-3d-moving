from app.report.build import outcome_of, quality_diff
from app.report.failures import classify


def rep(errors=(), warnings=(), **kw):
    base = {
        "is_usable": not errors,
        "errors": [{"code": c} for c in errors],
        "warnings": [{"code": c} for c in warnings],
        "face_count": 100,
        "vertex_count": 50,
        "connected_components": 1,
        "open_boundary_edges": 0,
        "non_manifold_edges": 0,
        "duplicate_vertices": 0,
        "degenerate_faces": 0,
        "centered": True,
        "grounded": True,
        "winding_consistent": True,
    }
    return {**base, **kw}


def test_outcome():
    assert outcome_of(rep()).value == "USABLE"
    assert outcome_of(rep(warnings=["open_boundary"])).value == "USABLE_WITH_WARNINGS"
    assert outcome_of(rep(errors=["fragmented"])).value == "NOT_USABLE"


def test_classify_marks_fixed_and_remaining():
    raw = rep(warnings=["small_components", "not_grounded", "flat_geometry"])
    repaired = rep(warnings=["flat_geometry"])
    found = {f["type"]: f for f in classify(raw, repaired, {"type": "convex_hull"})}
    assert found["FLOATING_COMPONENT"]["fixed_by_repair"]
    assert found["INVALID_ORIGIN"]["fixed_by_repair"]
    assert not found["COLLAPSED_BACK"]["fixed_by_repair"]
    assert all(f["remedy"] for f in found.values())


def test_classify_collider_fallback():
    found = classify(rep(), rep(), {"type": "bounding_box", "reason": "납작"})
    assert found[0]["type"] == "COLLISION_FAILURE"


def test_quality_diff_improvement_flags():
    raw = rep(warnings=["small_components", "not_grounded"], connected_components=2, grounded=False)
    rows = {r["metric"]: r for r in quality_diff(raw, rep())}
    assert rows["connected_components"]["improved"]
    assert rows["grounded"]["improved"]
    assert rows["warnings"]["before"] == 2 and rows["warnings"]["after"] == 0
    assert rows["face_count"]["improved"] is None
