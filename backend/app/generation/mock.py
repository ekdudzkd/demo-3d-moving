"""MockAdapter: GPU 없이 실루엣을 두께 있게 밀어낸 메시를 만든다.

CI·프론트 개발용. 실제 모델처럼 원점이 어긋나고 작은 떠 있는 조각이 섞인 출력을 일부러 만들어
검사·보정 단계가 실제로 일을 하게 한다.
"""

from __future__ import annotations

import time
from pathlib import Path

import cv2
import numpy as np
import trimesh
from PIL import Image
from scipy import ndimage
from shapely.geometry import Polygon

from app.core.errors import ErrorCode, PipelineError

from .base import (
    EnvironmentStatus,
    GenerationOptions,
    GenerationResult,
    ImageTo3DAdapter,
    ModelInfo,
)

WORK = 128
DEPTH_RATIO = 0.25


class MockAdapter(ImageTo3DAdapter):
    name = "mock"

    def __init__(self, fail: str = "", delay_ms: int = 0, artifacts: bool = True):
        self.fail = fail
        self.delay_ms = delay_ms
        self.artifacts = artifacts

    def get_model_info(self) -> ModelInfo:
        return ModelInfo(
            name="mock",
            version="extrude-1",
            code_license="MIT",
            weights_license="-",
            min_vram_mb=0,
            output_format="obj",
            commercial_use="allowed",
            description="실루엣 돌출 메시. 개발·테스트용이며 AI 모델이 아님",
        )

    def validate_environment(self) -> EnvironmentStatus:
        return EnvironmentStatus(ok=True, device="cpu")

    def generate(
        self, input_rgba: Path, options: GenerationOptions, out_dir: Path, job_id: str
    ) -> GenerationResult:
        out_dir.mkdir(parents=True, exist_ok=True)
        log_path = out_dir / "model.log"
        log = [f"mock generate job={job_id} seed={options.seed}"]
        started = time.perf_counter()
        if self.delay_ms:
            time.sleep(self.delay_ms / 1000)

        if self.fail == "oom":
            log_path.write_text("\n".join([*log, "CUDA out of memory (주입된 실패)"]), "utf-8")
            raise PipelineError(ErrorCode.CUDA_OOM, "mock: CUDA out of memory")
        if self.fail == "timeout":
            raise PipelineError(ErrorCode.GENERATION_TIMEOUT, "mock: timeout")
        if self.fail == "internal":
            raise RuntimeError("mock: 예상하지 못한 오류")

        mesh_path = out_dir / "raw.obj"
        if self.fail == "empty":
            mesh_path.write_text("# empty\n", "utf-8")
        else:
            mesh = silhouette_mesh(np.asarray(Image.open(input_rgba).convert("RGBA")))
            if self.artifacts:
                mesh = add_artifacts(mesh, options.seed)
            mesh.export(mesh_path)
            log.append(f"vertices={len(mesh.vertices)} faces={len(mesh.faces)}")

        elapsed = round((time.perf_counter() - started) * 1000)
        log.append(f"done in {elapsed}ms")
        log_path.write_text("\n".join(log) + "\n", "utf-8")
        return GenerationResult(
            job_id=job_id,
            model_name=self.name,
            model_version=self.get_model_info().version,
            options=options,
            mesh_path=str(mesh_path),
            mesh_format="obj",
            generation_time_ms=elapsed,
            log_path=str(log_path),
            warnings=["Mock 생성기 결과입니다. 실제 AI 모델 출력이 아닙니다."],
        )


def silhouette_mesh(rgba: np.ndarray) -> trimesh.Trimesh:
    alpha = rgba[..., 3]
    small = cv2.resize(alpha, (WORK, WORK), interpolation=cv2.INTER_AREA) > 127
    contours, _ = cv2.findContours(small.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        raise PipelineError(ErrorCode.MESH_EMPTY, "mock: 실루엣 없음")
    contour = max(contours, key=cv2.contourArea)
    contour = cv2.approxPolyDP(contour, 0.8, True).reshape(-1, 2).astype(np.float64)
    if len(contour) < 3:
        raise PipelineError(ErrorCode.MESH_EMPTY, "mock: 실루엣이 너무 작음")

    # 이미지 좌표 → x 오른쪽, y 위쪽, 한 변 1.0
    pts = np.column_stack([contour[:, 0] / WORK - 0.5, 0.5 - contour[:, 1] / WORK])
    polygon = Polygon(pts).buffer(0)
    if polygon.geom_type == "MultiPolygon":
        polygon = max(polygon.geoms, key=lambda g: g.area)
    width = float(max(np.ptp(pts[:, 0]), np.ptp(pts[:, 1])))
    depth = width * DEPTH_RATIO
    mesh = trimesh.creation.extrude_polygon(polygon, height=depth)
    mesh.apply_translation([0, 0, -depth / 2])
    # 실제 생성 메시와 비슷한 밀도로 세분화 (검사·보정·감소 단계가 의미 있도록)
    mesh = mesh.subdivide_to_size(max_edge=width * 0.03, max_iter=10)

    mesh.visual = trimesh.visual.ColorVisuals(
        mesh, vertex_colors=_sample_colors(rgba, mesh.vertices)
    )
    return mesh


def _sample_colors(rgba: np.ndarray, vertices: np.ndarray) -> np.ndarray:
    h, w = rgba.shape[:2]
    # 경계 밖 좌표는 가장 가까운 안쪽 픽셀 색을 쓴다. 그림 윤곽선(검정)이 측면 전체에 번지지 않도록
    # 마스크를 조금 깎은 영역에서 고른다
    solid = rgba[..., 3] > 127
    inner = ndimage.binary_erosion(solid, iterations=max(1, round(min(h, w) * 0.02)))
    source = inner if inner.sum() > 0.2 * solid.sum() else solid
    _, (iy, ix) = ndimage.distance_transform_edt(~source, return_indices=True)
    px = np.clip(((vertices[:, 0] + 0.5) * w).astype(int), 0, w - 1)
    py = np.clip(((0.5 - vertices[:, 1]) * h).astype(int), 0, h - 1)
    rgb = rgba[iy[py, px], ix[py, px], :3]
    return np.column_stack([rgb, np.full(len(rgb), 255, np.uint8)])


def add_artifacts(mesh: trimesh.Trimesh, seed: int) -> trimesh.Trimesh:
    """실제 생성 모델 출력처럼: 원점 중심(바닥 아님), 작은 떠 있는 조각."""
    rng = np.random.default_rng(seed)
    chip = trimesh.creation.icosphere(subdivisions=0, radius=0.02)
    chip.apply_translation(mesh.bounds[1] + rng.uniform(0.05, 0.15, 3))
    chip.visual = trimesh.visual.ColorVisuals(
        chip, vertex_colors=np.tile([128, 128, 128, 255], (len(chip.vertices), 1))
    )
    combined = trimesh.util.concatenate([mesh, chip])
    combined.apply_translation(-combined.bounds.mean(axis=0) + rng.uniform(-0.05, 0.05, 3))
    return combined
