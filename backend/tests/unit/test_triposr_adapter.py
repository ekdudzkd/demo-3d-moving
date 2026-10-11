"""TripoSRAdapter의 모델 없는 부분: 회색 합성, 좌표 변환, OOM 재시도, 환경 점검."""

from types import SimpleNamespace

import numpy as np
import pytest
import trimesh
from PIL import Image

from app.core.errors import ErrorCode, PipelineError
from app.generation.base import GenerationOptions
from app.generation.triposr import TO_Y_UP, TripoSRAdapter, composite_gray


def test_composite_gray_blends_alpha_on_gray():
    rgba = np.zeros((512, 512, 4), np.uint8)
    rgba[100:200, 100:200] = (255, 0, 0, 255)
    out = np.asarray(composite_gray(rgba))
    assert out.shape == (512, 512, 3)
    assert tuple(out[150, 150]) == (255, 0, 0)
    assert tuple(out[10, 10]) == (128, 128, 128)


def test_composite_gray_resizes_to_512():
    assert composite_gray(np.zeros((300, 300, 4), np.uint8)).size == (512, 512)


def test_to_y_up_is_rotation_mapping_axes():
    r = TO_Y_UP[:3, :3]
    assert np.isclose(np.linalg.det(r), 1.0)
    # TripoSR 위(+z) → +y, 정면(+x) → +z, 이미지 오른쪽(+y) → +x
    assert np.allclose(r @ [0, 0, 1], [0, 1, 0])
    assert np.allclose(r @ [1, 0, 0], [0, 0, 1])
    assert np.allclose(r @ [0, 1, 0], [1, 0, 0])


class FakeModel:
    def __init__(self):
        self.renderer = SimpleNamespace(chunks=[])
        self.renderer.set_chunk_size = self.renderer.chunks.append

    def parameters(self):
        yield SimpleNamespace(device=SimpleNamespace(type="cpu"))


def fake_adapter(settings, run):
    adapter = TripoSRAdapter(settings, load=False)
    adapter.model = FakeModel()
    adapter.torch = SimpleNamespace(
        manual_seed=lambda s: None,
        cuda=SimpleNamespace(is_available=lambda: False, empty_cache=lambda: None),
    )
    adapter._run = run
    return adapter


def write_input(tmp_path):
    path = tmp_path / "in.png"
    Image.fromarray(np.zeros((512, 512, 4), np.uint8), "RGBA").save(path)
    return path


def test_oom_retries_once_with_lower_settings(settings, tmp_path):
    calls = []

    def run(image, options, chunk, device):
        calls.append((options.mc_resolution, chunk))
        if len(calls) == 1:
            raise RuntimeError("CUDA out of memory. Tried to allocate 2.00 GiB")
        return trimesh.creation.box(), None, {"forward": 10.0, "extract_mesh": 5.0}, 1234, []

    adapter = fake_adapter(settings, run)
    result = adapter.generate(
        write_input(tmp_path), GenerationOptions(mc_resolution=256), tmp_path / "gen", "j1"
    )
    assert calls == [(256, settings.triposr_chunk_size), (192, 2048)]
    assert result.options.mc_resolution == 192
    assert result.generation_time_ms == 15 and result.peak_vram_mb == 1234
    assert any("재시도" in w for w in result.warnings)
    assert (tmp_path / "gen" / "raw.obj").exists()
    assert (tmp_path / "gen" / "input_gray.png").exists()
    # 재시도 뒤 원래 chunk로 되돌린다
    assert adapter.model.renderer.chunks[-1] == settings.triposr_chunk_size


def test_oom_twice_raises_cuda_oom(settings, tmp_path):
    def run(*_):
        raise RuntimeError("CUDA out of memory")

    adapter = fake_adapter(settings, run)
    with pytest.raises(PipelineError) as e:
        adapter.generate(write_input(tmp_path), GenerationOptions(), tmp_path / "gen", "j2")
    assert e.value.code is ErrorCode.CUDA_OOM and e.value.retryable
    assert "out of memory" in (tmp_path / "gen" / "model.log").read_text("utf-8")


def test_other_errors_not_retried(settings, tmp_path):
    calls = []

    def run(*_):
        calls.append(1)
        raise ValueError("boom")

    with pytest.raises(ValueError):
        fake_adapter(settings, run).generate(
            write_input(tmp_path), GenerationOptions(), tmp_path / "gen", "j3"
        )
    assert len(calls) == 1


def test_output_rotated_to_y_up(settings, tmp_path):
    # TripoSR 좌표에서 z로 긴 막대 → 결과에서는 y로 길어야 한다
    rod = trimesh.creation.box(extents=(0.1, 0.1, 1.0))

    def run(*_):
        return rod, None, {"forward": 1.0}, None, []

    result = fake_adapter(settings, run).generate(
        write_input(tmp_path), GenerationOptions(), tmp_path / "gen", "j4"
    )
    ext = trimesh.load(result.mesh_path, force="mesh").extents
    assert ext[1] > 0.9 and ext[0] < 0.2 and ext[2] < 0.2


def test_environment_reports_missing_repo(settings, tmp_path):
    settings.triposr_repo_dir = tmp_path / "nope"
    status = TripoSRAdapter(settings, load=False).validate_environment()
    assert not status.ok
    assert status.problems
