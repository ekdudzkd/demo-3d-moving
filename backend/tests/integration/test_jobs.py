import json
from pathlib import Path

import pytest

from app.core.context import build_context
from app.db.models import Job
from app.jobs.queue import claim_next, recover_stale
from app.worker import run_pending

SAMPLES = Path(__file__).parents[3] / "assets" / "samples"
STAGE_ORDER = ["PREPROCESSING", "GENERATING", "VALIDATING", "REPAIRING", "EXPORTING"]


def confirmed_project(client, sample="apple"):
    data = (SAMPLES / f"{sample}.png").read_bytes()
    pid = client.post("/api/projects", files={"file": ("a.png", data, "image/png")}).json()["id"]
    assert client.post(f"/api/projects/{pid}/mask/confirm", json={}).status_code == 200
    return pid


def new_job(client, pid, **body):
    r = client.post(f"/api/projects/{pid}/jobs", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def worker_ctx(settings, **overrides):
    return build_context(settings.model_copy(update=overrides))


def test_job_requires_confirmed_mask(client):
    data = (SAMPLES / "apple.png").read_bytes()
    pid = client.post("/api/projects", files={"file": ("a.png", data, "image/png")}).json()["id"]
    assert client.post(f"/api/projects/{pid}/jobs", json={}).status_code == 409


def test_job_runs_to_completion(client, settings):
    job = new_job(client, confirmed_project(client))
    assert job["status"] == "QUEUED"
    assert run_pending(worker_ctx(settings)) == 1

    done = client.get(f"/api/jobs/{job['id']}").json()
    assert done["status"] == "COMPLETED", done["error"]
    assert done["outcome"] in {"USABLE", "USABLE_WITH_WARNINGS"}
    assert done["model_name"] == "mock"
    assert [s["stage"] for s in done["stages"]] == STAGE_ORDER
    assert all(s["elapsed_ms"] is not None for s in done["stages"])
    for key in ("input_normalized", "raw_mesh", "raw_glb", "repaired_glb", "report", "asset"):
        assert key in done["files"], key
        assert client.get(done["files"][key]).status_code == 200


def test_sse_stream_replays_events_in_order(client, settings):
    job = new_job(client, confirmed_project(client))
    run_pending(worker_ctx(settings))
    with client.stream("GET", f"/api/jobs/{job['id']}/events") as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        text = "".join(r.iter_text())
    events = [json.loads(line[6:]) for line in text.splitlines() if line.startswith('data: {"seq"')]
    entered = [e["stage"] for e in events if e["kind"] == "enter"]
    assert entered == STAGE_ORDER
    assert events[-1]["stage"] == "COMPLETED"
    assert "event: end" in text

    # Last-Event-ID 이후 이벤트만
    last = events[-2]["seq"]
    with client.stream(
        "GET", f"/api/jobs/{job['id']}/events", headers={"Last-Event-ID": str(last)}
    ) as r:
        text = "".join(r.iter_text())
    assert text.count('data: {"seq"') == 1


@pytest.mark.parametrize(
    "fail, stage, code, retryable",
    [
        ("oom", "GENERATING", "CUDA_OOM", True),
        ("empty", "VALIDATING", "MESH_EMPTY", True),
        ("internal", "GENERATING", "INTERNAL", True),
    ],
)
def test_job_failure_recorded(client, settings, fail, stage, code, retryable):
    job = new_job(client, confirmed_project(client))
    run_pending(worker_ctx(settings, mock_fail=fail))
    body = client.get(f"/api/jobs/{job['id']}").json()
    assert body["status"] == "FAILED"
    err = body["error"]
    assert (err["stage"], err["code"], err["retryable"]) == (stage, code, retryable)
    assert err["user_message"]
    assert err["log_url"] and client.get(err["log_url"]).status_code == 200
    assert body["events"][-1]["kind"] == "error"


def test_cancel_queued_job(client, settings):
    job = new_job(client, confirmed_project(client))
    r = client.post(f"/api/jobs/{job['id']}/cancel")
    assert r.json()["status"] == "CANCELLED"
    assert run_pending(worker_ctx(settings)) == 0
    assert client.post(f"/api/jobs/{job['id']}/cancel").status_code == 409


def test_cancel_running_job_stops_at_stage_boundary(client, settings):
    job = new_job(client, confirmed_project(client))
    ctx = worker_ctx(settings)
    with ctx.session() as s:
        claimed = claim_next(s)
        claimed.cancel_requested = True
        s.commit()
    from app.jobs.pipeline import run_job

    assert run_job(ctx, job["id"]) == "CANCELLED"
    body = client.get(f"/api/jobs/{job['id']}").json()
    assert body["error"]["code"] == "CANCELLED"


def test_retry_creates_new_job_keeping_old(client, settings):
    pid = confirmed_project(client)
    job = new_job(client, pid)
    run_pending(worker_ctx(settings, mock_fail="oom"))
    r = client.post(f"/api/jobs/{job['id']}/retry", json={"options": {"mc_resolution": 128}})
    assert r.status_code == 201
    new = r.json()
    assert new["retry_of"] == job["id"]
    assert new["options"]["mc_resolution"] == 128
    run_pending(worker_ctx(settings))
    assert client.get(f"/api/jobs/{new['id']}").json()["status"] == "COMPLETED"
    assert client.get(f"/api/jobs/{job['id']}").json()["status"] == "FAILED"


def test_invalid_options_rejected(client):
    pid = confirmed_project(client)
    assert (
        client.post(
            f"/api/projects/{pid}/jobs", json={"options": {"mc_resolution": 9999}}
        ).status_code
        == 422
    )
    assert client.post(f"/api/projects/{pid}/jobs", json={"generator": "sf3d"}).status_code == 422


def test_recover_stale_jobs(client, settings):
    job = new_job(client, confirmed_project(client))
    ctx = worker_ctx(settings)
    with ctx.session() as s:
        claim_next(s)
    with ctx.session() as s:
        assert recover_stale(s) == 1
        assert s.get(Job, job["id"]).status == "FAILED"


def test_preprocess_options_applied(client, settings):
    job = new_job(client, confirmed_project(client), preprocess={"foreground_ratio": 0.6})
    run_pending(worker_ctx(settings))
    from PIL import Image

    body = client.get(f"/api/jobs/{job['id']}").json()
    ctx = worker_ctx(settings)
    path = ctx.storage.root / body["files"]["input_normalized"].removeprefix("/api/files/")
    alpha = Image.open(path).getchannel("A")
    x0, y0, x1, y1 = alpha.point(lambda v: 255 if v > 127 else 0).getbbox()
    assert abs(max(x1 - x0, y1 - y0) / 512 - 0.6) < 0.03


def test_completed_job_has_asset(client, settings):
    job = new_job(client, confirmed_project(client, "star"))
    run_pending(worker_ctx(settings))
    body = client.get(f"/api/jobs/{job['id']}").json()
    assert body["asset_id"]
    asset = client.get(f"/api/assets/{body['asset_id']}").json()
    assert asset["interaction_type"] == "movable"
    assert asset["collision_type"] in {"convex_hull", "bounding_box"}
    assert asset["spawn_position"] == [0.0, 1.0, 0.0]
    assert client.get(asset["mesh_url"]).headers["content-type"] == "model/gltf-binary"
    assert client.get("/api/assets/ast_nope").status_code == 404


def test_report_contents(client, settings):
    job = new_job(client, confirmed_project(client, "car"))
    run_pending(worker_ctx(settings))
    body = client.get(f"/api/jobs/{job['id']}").json()
    report = client.get(body["files"]["report"]).json()
    assert report["outcome"] == body["outcome"]
    assert report["model"]["name"] == "mock"
    assert report["input"]["mask"]["version"] == body["mask_version"]
    assert [t["stage"] for t in report["timings"]["stages"]] == STAGE_ORDER
    diff = {r["metric"]: r for r in report["quality"]["diff"]}
    assert diff["grounded"]["improved"] and diff["connected_components"]["improved"]
    types = {f["type"]: f for f in report["failure_types"]}
    assert types["FLOATING_COMPONENT"]["fixed_by_repair"]
    assert types["INVALID_ORIGIN"]["fixed_by_repair"]
    for url in report["downloads"].values():
        assert client.get(url).status_code == 200


def test_timestamps_are_utc_aware(client):
    job = new_job(client, confirmed_project(client))
    body = client.get(f"/api/jobs/{job['id']}").json()
    assert body["created_at"].endswith("Z") or body["created_at"].endswith("+00:00")
    assert body["events"][0]["at"].endswith("Z") or body["events"][0]["at"].endswith("+00:00")


def test_cancelled_queued_job_has_error_info(client):
    job = new_job(client, confirmed_project(client))
    body = client.post(f"/api/jobs/{job['id']}/cancel").json()
    assert body["error"]["code"] == "CANCELLED" and body["error"]["retryable"]


def test_models_endpoint_reports_measured_stats(client, settings):
    before = {a["name"]: a for a in client.get("/api/health/models").json()["adapters"]}
    assert before["mock"]["measured"] is None
    new_job(client, confirmed_project(client))
    assert run_pending(worker_ctx(settings)) == 1

    after = {a["name"]: a for a in client.get("/api/health/models").json()["adapters"]}
    m = after["mock"]["measured"]
    assert m["recent_jobs"] == 1 and m["usable"] == 1
    assert m["generation_ms_median"] is not None and m["generation_ms_median"] >= 0
    assert after["triposr"]["measured"] is None
