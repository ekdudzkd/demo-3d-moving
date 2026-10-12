"""5-2 편집 버전: e0 생성, append-only 이력·undo 체인, 실패 버전, 409, 라벨 회전, SSE (D-027)."""

from pathlib import Path

import numpy as np
from test_jobs import confirmed_project, new_job, worker_ctx

from app.worker import run_pending
from mesh_ready_check import load_mesh

ROTATE = {"type": "rotate90", "axis": "toward_viewer", "k": 1}
THICKER = {"type": "scale_axis", "axis": "toward_viewer", "factor": 2.0}


def completed_asset(client, settings, **options):
    job = new_job(client, confirmed_project(client), options=options)
    assert run_pending(worker_ctx(settings)) == 1
    done = client.get(f"/api/jobs/{job['id']}").json()
    assert done["status"] == "COMPLETED", done["error"]
    return done["asset_id"]


def edit(client, asset_id, *ops, panel="front", text=""):
    return client.post(
        f"/api/assets/{asset_id}/edits", json={"panel": panel, "text": text, "ops": list(ops)}
    )


def edits(client, asset_id):
    return client.get(f"/api/assets/{asset_id}/edits").json()


def local_path(settings, url: str) -> Path:
    return settings.data_dir / url.removeprefix("/api/files/")


def test_completed_job_has_e0(client, settings):
    aid = completed_asset(client, settings)
    state = edits(client, aid)
    assert state["active_version"] == 0
    assert state["view_label"] == "front"
    assert state["can_undo"] is False
    (e0,) = state["versions"]
    assert (e0["status"], e0["kind"], e0["ops"]) == (
        "ready",
        "base",
        [{"op": "label", "label": "front"}],
    )
    asset = client.get(f"/api/assets/{aid}").json()
    assert asset["active_version"] == 0
    assert asset["mesh_url"].endswith("repaired.glb")  # front면 보정 GLB 그대로


def test_edit_undo_chain_and_history(client, settings):
    aid = completed_asset(client, settings)
    ctx = worker_ctx(settings)

    r = edit(client, aid, ROTATE, text="옆으로 누웠어")
    assert r.status_code == 202, r.text
    assert r.json()["version"] == 1
    # pending 중에는 edit·undo·revert 모두 409
    assert edit(client, aid, THICKER).json()["code"] == "edit_in_progress"
    assert client.post(f"/api/assets/{aid}/edits/undo").status_code == 409
    assert client.post(f"/api/assets/{aid}/edits/revert", json={"to_version": 0}).status_code == 409
    assert edits(client, aid)["in_progress"] == 1

    assert run_pending(ctx) == 1
    state = edits(client, aid)
    assert state["active_version"] == 1
    e1 = state["versions"][1]
    assert e1["status"] == "ready" and e1["prev_state"] == 0
    assert e1["intent"]["text"] == "옆으로 누웠어"
    asset = client.get(f"/api/assets/{aid}").json()
    assert asset["mesh_url"].endswith("edits/e1.glb")
    assert client.get(asset["mesh_url"]).status_code == 200

    assert edit(client, aid, THICKER).status_code == 202
    run_pending(ctx)
    e2 = edits(client, aid)["versions"][2]
    e1_ext = np.ptp(np.array(e1["bounds"]), axis=0)
    e2_ext = np.ptp(np.array(e2["bounds"]), axis=0)
    assert np.allclose(e2_ext / e1_ext, [1, 1, 2], atol=0.01)  # 두께(z)만 2배, 크기 정규화 없음

    # undo 두 번 → e1, e0 순서로 내려가고 이력은 지워지지 않는다
    assert client.post(f"/api/assets/{aid}/edits/undo").json()["version"] == 3
    run_pending(ctx)
    assert client.post(f"/api/assets/{aid}/edits/undo").json()["version"] == 4
    run_pending(ctx)
    state = edits(client, aid)
    vs = state["versions"]
    assert vs[3]["ops"] == vs[1]["ops"] and vs[3]["prev_state"] == 0
    assert vs[4]["ops"] == vs[0]["ops"] and vs[4]["prev_state"] is None
    assert state["active_version"] == 4 and state["can_undo"] is False
    r = client.post(f"/api/assets/{aid}/edits/undo")
    assert (r.status_code, r.json()["code"]) == (409, "nothing_to_undo")

    # 원본·v0·모든 버전 파일 보존
    for v in vs[1:]:
        assert local_path(settings, v["mesh_url"]).is_file()
    assert local_path(settings, vs[0]["mesh_url"]).is_file()


def test_refuse_and_noop_do_not_create_versions(client, settings):
    aid = completed_asset(client, settings)
    r = edit(
        client,
        aid,
        {"type": "mirror", "axis": "screen_right"},
        {"type": "mirror", "axis": "screen_right"},
    )
    assert (r.status_code, r.json()["kind"]) == (200, "noop")
    r = edit(client, aid, {"type": "invert_last"})
    assert r.json() == {
        "kind": "refuse",
        "message": "되돌릴 편집이 없어요.",
        "reason_code": "nothing_to_invert",
        "suggested_text": None,
    }
    r = edit(
        client, aid, {"type": "scale_uniform", "factor": 10}, {"type": "scale_uniform", "factor": 2}
    )
    assert r.json()["reason_code"] == "out_of_range"
    assert len(edits(client, aid)["versions"]) == 1
    assert edit(client, aid, {"type": "rotate90", "axis": "screen_up", "k": 5}).status_code == 422


def test_failed_version_keeps_active(client, settings):
    aid = completed_asset(client, settings)
    assert edit(client, aid, ROTATE).status_code == 202
    assert run_pending(worker_ctx(settings, edit_fail="export")) == 1
    state = edits(client, aid)
    e1 = state["versions"][1]
    assert e1["status"] == "failed"
    assert e1["error"]["code"] == "EXPORT_FAILED"
    assert state["active_version"] == 0
    assert client.get(f"/api/assets/{aid}").json()["mesh_url"].endswith("repaired.glb")
    # 실패 버전으로는 되돌릴 수 없고, 다음 편집은 활성 버전(e0) 기준
    r = client.post(f"/api/assets/{aid}/edits/revert", json={"to_version": 1})
    assert (r.status_code, r.json()["code"]) == (409, "not_ready")
    assert client.post(f"/api/assets/{aid}/edits/revert", json={"to_version": 9}).status_code == 404
    r = edit(client, aid, THICKER)
    assert r.status_code == 202
    assert r.json()["version"] == 2
    run_pending(worker_ctx(settings))
    e2 = edits(client, aid)["versions"][2]
    assert e2["status"] == "ready" and e2["prev_state"] == 0
    assert e2["ops"] == [
        {"op": "label", "label": "front"},
        {"op": "scale", "factors": [1.0, 1.0, 2.0]},
    ]


def test_revert_appends_copy(client, settings):
    aid = completed_asset(client, settings)
    ctx = worker_ctx(settings)
    edit(client, aid, ROTATE)
    run_pending(ctx)
    edit(client, aid, THICKER)
    run_pending(ctx)
    r = client.post(f"/api/assets/{aid}/edits/revert", json={"to_version": 0})
    assert r.status_code == 202
    v = r.json()
    assert (v["version"], v["kind"], v["prev_state"]) == (3, "revert", 2)
    run_pending(ctx)
    state = edits(client, aid)
    assert state["active_version"] == 3
    assert state["versions"][3]["ops"] == state["versions"][0]["ops"]
    # revert도 undo로 되돌릴 수 있다 → e2 상태
    client.post(f"/api/assets/{aid}/edits/undo")
    run_pending(ctx)
    state = edits(client, aid)
    assert state["versions"][4]["ops"] == state["versions"][2]["ops"]


def test_side_label_rotates_e0(client, settings):
    front = completed_asset(client, settings)
    left = completed_asset(client, settings, view_label="left")
    state = edits(client, left)
    assert state["view_label"] == "left"
    e0 = state["versions"][0]
    assert e0["ops"] == [{"op": "label", "label": "left"}]
    asset = client.get(f"/api/assets/{left}").json()
    assert asset["mesh_url"].endswith("edits/e0.glb")
    assert asset["view_label"] == "left"
    # left 라벨: 그림의 가로(x)가 월드 z로 간다
    f_ext = np.ptp(np.array(client.get(f"/api/assets/{front}").json()["bounds"]), axis=0)
    l_ext = np.ptp(np.array(asset["bounds"]), axis=0)
    assert np.allclose(l_ext, f_ext[[2, 1, 0]], atol=1e-3)
    mesh, _ = load_mesh(local_path(settings, asset["mesh_url"]))
    assert np.isclose(mesh.bounds[0][1], 0.0, atol=1e-4)


def test_sse_reports_ready_and_active_change(client, settings):
    aid = completed_asset(client, settings)
    edit(client, aid, ROTATE)
    run_pending(worker_ctx(settings))
    with client.stream("GET", f"/api/assets/{aid}/events?follow=0") as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        text = "".join(r.iter_text())
    assert '"active_version": 1' in text
    assert "event: end" in text


def say(client, asset_id, text, panel="front"):
    return client.post(f"/api/assets/{asset_id}/edits", json={"panel": panel, "text": text})


def test_text_edit_goes_through_planner(client, settings):
    aid = completed_asset(client, settings)
    r = say(client, aid, "더 두껍게", panel="left")
    assert r.status_code == 202, r.text
    # left 패널의 화면 밖 방향은 월드 -x → x축 1.25배
    assert r.json()["ops"] == [{"op": "scale", "factors": [1.25, 1.0, 1.0]}]
    run_pending(worker_ctx(settings))
    e1 = edits(client, aid)["versions"][1]
    assert e1["intent"]["planner"] == "mock" and e1["intent"]["text"] == "더 두껍게"


def test_text_edit_refusals_and_clarify(client, settings):
    aid = completed_asset(client, settings)
    r = say(client, aid, "귀만 길게").json()
    assert (r["kind"], r["reason_code"]) == ("refuse", "part_edit")
    assert r["suggested_text"].startswith("전체를")
    assert say(client, aid, "45도 돌려").json()["reason_code"] == "angle_not_supported"
    assert say(client, aid, "360도 돌려").json()["kind"] == "noop"
    assert say(client, aid, "음 별로야").json()["kind"] == "clarify"
    assert say(client, aid, "반대로").json()["reason_code"] == "nothing_to_invert"
    assert say(client, aid, "   ").status_code == 422
    assert len(edits(client, aid)["versions"]) == 1
