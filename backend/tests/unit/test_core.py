from app.core.errors import ErrorCode, PipelineError
from app.db.models import Project


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["generator"] == "mock"


def test_database_created(ctx):
    assert (ctx.settings.data_dir / "draw2world.db").exists()
    with ctx.session() as s:
        s.add(Project(status="UPLOADED", width=1, height=1, validation={}))
        s.commit()
        assert s.query(Project).count() == 1


def test_files_serves_only_inside_projects(client, ctx):
    target = ctx.storage.project_dir("prj_x") / "a.json"
    target.parent.mkdir(parents=True)
    target.write_text("{}")
    assert client.get("/api/files/projects/prj_x/a.json").status_code == 200
    (ctx.settings.data_dir / "draw2world.secret").write_text("x")
    assert client.get("/api/files/draw2world.secret").status_code == 404
    assert client.get("/api/files/projects/../draw2world.secret").status_code == 404
    assert client.get("/api/files/projects/%2e%2e/draw2world.db").status_code == 404
    assert client.get("/api/files/projects/prj_x/missing.json").status_code == 404


def test_storage_url_roundtrip(ctx):
    p = ctx.storage.original("prj_1")
    assert ctx.storage.url(p) == "/api/files/projects/prj_1/original.png"


def test_pipeline_error_retryable():
    assert PipelineError(ErrorCode.CUDA_OOM).retryable
    assert not PipelineError(ErrorCode.INPUT_INVALID).retryable
    assert PipelineError(ErrorCode.CUDA_OOM).user_message
