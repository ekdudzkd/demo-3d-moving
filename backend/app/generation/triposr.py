"""TripoSRAdapter: 정규화 RGBA → 회색 배경 합성 → TripoSR → OBJ.

- 모델은 워커 프로세스에서 한 번 로드한다. 가중치는 MODEL_CACHE_DIR에 받는다 (커밋 금지).
- torchmcubes·rembg는 대체 모듈을 쓴다 (D-020).
- 출력 좌표계는 TripoSR 기본(z 위, 정면 +x)에서 우리 규약(y 위, 정면 +z, 이미지 오른쪽 +x)으로 돌린다.
- CUDA OOM이면 캐시를 비우고 chunk·mc 해상도를 낮춰 한 번 재시도한다. 그래도 실패하면 CUDA_OOM.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image

from app.core.config import Settings
from app.core.errors import ErrorCode, PipelineError

from . import triposr_shims
from .base import (
    EnvironmentStatus,
    GenerationOptions,
    GenerationResult,
    ImageTo3DAdapter,
    ModelInfo,
)

TRIPOSR_COMMIT = "107cefdc244c39106fa830359024f6a2f1c78871"
WEIGHTS_REPO = "stabilityai/TripoSR"
INPUT_SIZE = 512
BACKGROUND = 0.5  # TripoSR 학습 입력과 같은 회색 배경
RETRY_CHUNK_SIZE = 2048
RETRY_MAX_MC = 192

# TripoSR (z 위, 정면 +x, 이미지 오른쪽 +y) → (y 위, 정면 +z, 이미지 오른쪽 +x)
TO_Y_UP = np.array(
    [
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]
)


def composite_gray(rgba: np.ndarray, size: int = INPUT_SIZE) -> Image.Image:
    """RGBA를 회색 배경에 합성한 RGB. 전처리기가 이미 중심·비율을 맞췄으므로 크기만 맞춘다."""
    img = Image.fromarray(rgba, "RGBA")
    if img.size != (size, size):
        img = img.resize((size, size), Image.Resampling.LANCZOS)
    arr = np.asarray(img).astype(np.float32) / 255.0
    rgb = arr[..., :3] * arr[..., 3:4] + BACKGROUND * (1.0 - arr[..., 3:4])
    return Image.fromarray(np.round(rgb * 255).astype(np.uint8), "RGB")


def is_oom(exc: BaseException) -> bool:
    return "out of memory" in str(exc).lower()


class TripoSRAdapter(ImageTo3DAdapter):
    name = "triposr"

    def __init__(self, settings: Settings, load: bool = True):
        self.settings = settings
        self.repo_dir = Path(
            settings.triposr_repo_dir
            or os.environ.get("TRIPOSR_REPO_DIR", Path.home() / ".cache/d2w/TripoSR")
        ).expanduser()
        self.chunk_size = settings.triposr_chunk_size
        self.model = None
        self.model_load_time_ms = 0
        if load:
            self._load()

    # ---------- 정보·환경 ----------

    def get_model_info(self) -> ModelInfo:
        return ModelInfo(
            name="triposr",
            version=f"{TRIPOSR_COMMIT[:12]} / {WEIGHTS_REPO}",
            code_license="MIT",
            weights_license="MIT",
            min_vram_mb=4000,
            output_format="obj",
            commercial_use="allowed",
            description="단일 이미지 → 3D (feed-forward). 보이지 않는 뒷면은 모델이 추정한다",
        )

    def validate_environment(self) -> EnvironmentStatus:
        problems: list[str] = []
        try:
            import torch
        except ImportError:
            return EnvironmentStatus(ok=False, device="-", problems=["torch 미설치"])
        device = "cuda" if torch.cuda.is_available() else "cpu"
        gpu_name = vram = None
        if device == "cuda":
            gpu_name = torch.cuda.get_device_name(0)
            vram = torch.cuda.get_device_properties(0).total_memory // 2**20
            if vram < self.get_model_info().min_vram_mb:
                problems.append(f"VRAM {vram}MiB < 권장 {self.get_model_info().min_vram_mb}MiB")
        else:
            problems.append("CUDA 사용 불가 — CPU로는 너무 느려 지원하지 않음")
        if not (self.repo_dir / "tsr").is_dir():
            problems.append(f"TripoSR 소스 없음: {self.repo_dir} (scripts/setup-gpu-env.sh)")
        return EnvironmentStatus(
            ok=not problems, device=device, gpu_name=gpu_name, vram_total_mb=vram, problems=problems
        )

    # ---------- 로드 ----------

    def _load(self) -> None:
        import torch
        from huggingface_hub import hf_hub_download

        triposr_shims.install()
        if str(self.repo_dir) not in sys.path:
            sys.path.insert(0, str(self.repo_dir))
        from tsr.system import TSR

        started = time.perf_counter()
        cache = str(self.settings.model_cache_dir / "hf")
        config = hf_hub_download(WEIGHTS_REPO, "config.yaml", cache_dir=cache)
        hf_hub_download(WEIGHTS_REPO, "model.ckpt", cache_dir=cache)
        model = TSR.from_pretrained(
            str(Path(config).parent), config_name="config.yaml", weight_name="model.ckpt"
        )
        model.renderer.set_chunk_size(self.chunk_size)
        model.to("cuda" if torch.cuda.is_available() else "cpu")
        model.eval()
        self.model = model
        self.torch = torch
        self.model_load_time_ms = round((time.perf_counter() - started) * 1000)

    # ---------- 생성 ----------

    def generate(
        self, input_rgba: Path, options: GenerationOptions, out_dir: Path, job_id: str
    ) -> GenerationResult:
        if self.model is None:
            self._load()
        out_dir.mkdir(parents=True, exist_ok=True)
        log_path = out_dir / "model.log"
        log = [f"triposr generate job={job_id} options={options.model_dump()}"]
        warnings: list[str] = []
        torch = self.torch
        device = next(self.model.parameters()).device

        image = composite_gray(np.asarray(Image.open(input_rgba).convert("RGBA")))
        image.save(out_dir / "input_gray.png")

        torch.manual_seed(options.seed)
        used = options.model_copy()
        chunk = self.chunk_size
        try:
            for attempt in (1, 2):
                try:
                    mesh, texture, timings, peak, run_warnings = self._run(
                        image, used, chunk, device
                    )
                    warnings += run_warnings
                    break
                except Exception as exc:  # noqa: BLE001 — OOM만 재시도, 나머지는 그대로 올린다
                    if not is_oom(exc) or attempt == 2:
                        raise
                    log.append(f"attempt {attempt}: CUDA OOM ({exc}) → 재시도")
                    self._free()
                    chunk = min(chunk, RETRY_CHUNK_SIZE)
                    used = used.model_copy(
                        update={"mc_resolution": min(used.mc_resolution, RETRY_MAX_MC)}
                    )
                    warnings.append(
                        f"GPU 메모리 부족으로 낮은 설정으로 재시도함 "
                        f"(chunk {chunk}, mc_resolution {used.mc_resolution})"
                    )
        except Exception as exc:
            self._free()
            log.append(f"failed: {type(exc).__name__}: {exc}")
            log_path.write_text("\n".join(log) + "\n", "utf-8")
            if is_oom(exc):
                raise PipelineError(ErrorCode.CUDA_OOM, str(exc)) from exc
            raise
        finally:
            self.model.renderer.set_chunk_size(self.chunk_size)

        mesh.apply_transform(TO_Y_UP)
        mesh_path = out_dir / "raw.obj"
        texture_paths: list[str] = []
        if texture is not None:
            tex_path = out_dir / "texture.png"
            texture.save(tex_path)
            texture_paths.append(str(tex_path))
        mesh.export(mesh_path)
        if len(mesh.faces) == 0:
            warnings.append("모델이 빈 메시를 만들었습니다")

        gen_ms = round(sum(timings.values()))
        log += [f"{k}_ms={v:.0f}" for k, v in timings.items()]
        log += [
            f"vertices={len(mesh.vertices)} faces={len(mesh.faces)}",
            f"peak_vram_mb={peak}",
            f"model_load_ms={self.model_load_time_ms}",
        ]
        log_path.write_text("\n".join(log) + "\n", "utf-8")
        return GenerationResult(
            job_id=job_id,
            model_name=self.name,
            model_version=self.get_model_info().version,
            options=used,
            mesh_path=str(mesh_path),
            mesh_format="obj",
            texture_paths=texture_paths,
            generation_time_ms=gen_ms,
            model_load_time_ms=self.model_load_time_ms,
            peak_vram_mb=peak,
            log_path=str(log_path),
            warnings=warnings,
        )

    def _run(self, image: Image.Image, options: GenerationOptions, chunk: int, device):
        """(메시, 텍스처 이미지|None, 단계별 ms, 최대 VRAM MiB, 경고)"""
        torch = self.torch
        cuda = device.type == "cuda"
        timings: dict[str, float] = {}

        def tick(name: str, started: float) -> None:
            if cuda:
                torch.cuda.synchronize()
            timings[name] = (time.perf_counter() - started) * 1000

        if cuda:
            torch.cuda.reset_peak_memory_stats()
        self.model.renderer.set_chunk_size(chunk)
        t = time.perf_counter()
        with torch.no_grad():
            scene_codes = self.model([image], device=device)
        tick("forward", t)

        t = time.perf_counter()
        meshes = self.model.extract_mesh(
            scene_codes, not options.bake_texture, resolution=options.mc_resolution
        )
        tick("extract_mesh", t)
        mesh: trimesh.Trimesh = meshes[0]

        texture = None
        warnings: list[str] = []
        if options.bake_texture and len(mesh.faces):
            t = time.perf_counter()
            try:
                mesh, texture = self._bake(mesh, scene_codes[0], options.texture_resolution)
            except Exception as exc:  # noqa: BLE001 — OpenGL 컨텍스트가 없으면 정점 색으로 대신
                if is_oom(exc):
                    raise
                with torch.no_grad():
                    color = self.model.renderer.query_triplane(
                        self.model.decoder,
                        torch.as_tensor(mesh.vertices, dtype=torch.float32, device=device),
                        scene_codes[0],
                    )["color"]
                mesh.visual.vertex_colors = (color.clamp(0, 1).cpu().numpy() * 255).astype(np.uint8)
                warnings.append(f"텍스처 베이크 실패로 정점 색을 사용함 ({type(exc).__name__})")
            tick("bake_texture", t)

        peak = round(torch.cuda.max_memory_allocated() / 2**20) if cuda else None
        return mesh, texture, timings, peak, warnings

    def _bake(self, mesh: trimesh.Trimesh, scene_code, resolution: int):
        """TripoSR 텍스처 베이크 → UV 메시 + 텍스처. 뷰어·GLB 내장은 3-5에서."""
        # tsr.bake_texture.bake_texture는 위치 텐서를 CPU에 둔 채 질의해 GPU 모델에서 실패한다.
        # 아틀라스·래스터화만 가져다 쓰고 색 질의는 모델 장치에서 한다
        from tsr.bake_texture import make_atlas, rasterize_position_atlas

        torch = self.torch
        padding = round(max(2, resolution / 256))
        atlas = make_atlas(mesh, resolution, padding)
        positions = rasterize_position_atlas(
            mesh, atlas["vmapping"], atlas["indices"], atlas["uvs"], resolution, padding
        ).reshape(-1, 4)
        device = next(self.model.parameters()).device
        with torch.no_grad():
            rgb = self.model.renderer.query_triplane(
                self.model.decoder,
                torch.tensor(positions[:, :3], dtype=torch.float32, device=device),
                scene_code,
            )["color"]
        rgb = rgb.clamp(0, 1).cpu().numpy()
        rgb[positions[:, 3] == 0.0] = 0.0  # 아틀라스 빈 곳
        colors = (rgb.reshape(resolution, resolution, 3) * 255.0).astype(np.uint8)
        # 래스터 결과는 아래쪽이 v=0 → 이미지는 위쪽이 v=1이 되도록 뒤집는다
        texture = Image.fromarray(colors, "RGB").transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        uv_mesh = trimesh.Trimesh(
            vertices=mesh.vertices[atlas["vmapping"]], faces=atlas["indices"], process=False
        )
        uv_mesh.visual = trimesh.visual.TextureVisuals(
            uv=atlas["uvs"], material=trimesh.visual.material.SimpleMaterial(image=texture)
        )
        return uv_mesh, texture

    def _free(self) -> None:
        import gc

        gc.collect()
        if self.torch.cuda.is_available():
            self.torch.cuda.empty_cache()
