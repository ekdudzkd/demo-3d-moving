import numpy as np
import pytest
from PIL import Image, ImageDraw

from app.core.errors import ErrorCode, PipelineError
from app.generation.base import GenerationOptions
from app.generation.mock import MockAdapter
from app.generation.registry import get_adapter
from mesh_ready_check import inspect_path


@pytest.fixture
def rgba(tmp_path):
    img = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    ImageDraw.Draw(img).ellipse((40, 100, 472, 412), fill=(214, 48, 49, 255))
    path = tmp_path / "in.png"
    img.save(path)
    return path


def test_mock_generates_colored_obj(rgba, tmp_path):
    r = MockAdapter().generate(rgba, GenerationOptions(), tmp_path / "out", "job_1")
    assert r.mesh_format == "obj"
    report = inspect_path(r.mesh_path)
    assert report.face_count > 50
    assert report.has_vertex_colors
    # 일부러 넣은 결함: 떠 있는 조각, 바닥에 안 닿음
    assert report.small_components == 1
    assert not report.grounded
    assert r.generation_time_ms >= 0
    assert "mock generate" in open(r.log_path, encoding="utf-8").read()


def test_mock_without_artifacts_is_clean(rgba, tmp_path):
    r = MockAdapter(artifacts=False).generate(rgba, GenerationOptions(), tmp_path, "j")
    report = inspect_path(r.mesh_path)
    assert report.connected_components == 1
    assert report.open_boundary_edges == 0
    x, y, _ = report.extents
    assert abs(x - 0.84) < 0.03 and abs(y - 0.61) < 0.03


def test_mock_colors_follow_image(rgba, tmp_path):
    r = MockAdapter(artifacts=False).generate(rgba, GenerationOptions(), tmp_path, "j")
    import trimesh

    mesh = trimesh.load(r.mesh_path, force="mesh")
    colors = np.asarray(mesh.visual.vertex_colors)[:, :3].astype(int)
    assert np.abs(colors - [214, 48, 49]).max() < 5


@pytest.mark.parametrize(
    "fail, code",
    [("oom", ErrorCode.CUDA_OOM), ("timeout", ErrorCode.GENERATION_TIMEOUT)],
)
def test_mock_failures(rgba, tmp_path, fail, code):
    with pytest.raises(PipelineError) as e:
        MockAdapter(fail=fail).generate(rgba, GenerationOptions(), tmp_path, "j")
    assert e.value.code is code
    assert e.value.retryable


def test_mock_empty_output(rgba, tmp_path):
    r = MockAdapter(fail="empty").generate(rgba, GenerationOptions(), tmp_path, "j")
    report = inspect_path(r.mesh_path)
    assert not report.is_usable
    assert report.errors[0].code == "empty_mesh"


def test_registry(settings):
    assert get_adapter("mock", settings).name == "mock"
    with pytest.raises(PipelineError) as e:
        get_adapter("sf3d", settings)
    assert e.value.code is ErrorCode.MODEL_UNAVAILABLE
    with pytest.raises(PipelineError):
        get_adapter("nope", settings)


def test_models_endpoint(client):
    body = client.get("/api/health/models").json()
    assert body["default"] == "mock"
    by_name = {a["name"]: a for a in body["adapters"]}
    assert by_name["mock"]["enabled"] and by_name["mock"]["environment"]["ok"]
    assert not by_name["sf3d"]["enabled"]
    assert "triposr" in by_name
