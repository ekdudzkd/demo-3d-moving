def test_openapi_has_contract(client):
    spec = client.get("/openapi.json").json()
    paths = spec["paths"]
    for path in (
        "/api/projects",
        "/api/projects/{project_id}",
        "/api/projects/{project_id}/segment",
        "/api/projects/{project_id}/mask/confirm",
        "/api/projects/{project_id}/jobs",
        "/api/jobs/{job_id}",
        "/api/jobs/{job_id}/events",
        "/api/jobs/{job_id}/cancel",
        "/api/jobs/{job_id}/retry",
        "/api/assets/{asset_id}",
        "/api/assets/{asset_id}/edits",
        "/api/assets/{asset_id}/edits/undo",
        "/api/assets/{asset_id}/edits/revert",
        "/api/assets/{asset_id}/events",
        "/api/health",
        "/api/health/models",
    ):
        assert path in paths, path
    schemas = spec["components"]["schemas"]
    job = schemas["JobOut"]["properties"]
    for key in ("status", "outcome", "error", "stages", "events", "files", "asset_id"):
        assert key in job
    assert set(schemas["JobError"]["required"]) >= {"stage", "code", "user_message", "retryable"}
