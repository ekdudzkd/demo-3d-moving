"""이미지→3D 생성 adapter 인터페이스 (docs/proposal.md §4)."""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from pydantic import BaseModel, Field


class GenerationOptions(BaseModel):
    seed: int = 0
    mc_resolution: int = Field(256, ge=32, le=512)
    bake_texture: bool = False
    texture_resolution: int = Field(1024, ge=128, le=4096)
    device: str = "cuda"


class ModelInfo(BaseModel):
    name: str
    version: str
    code_license: str
    weights_license: str
    min_vram_mb: int
    output_format: str
    commercial_use: str  # allowed | conditional | no
    description: str = ""


class EnvironmentStatus(BaseModel):
    ok: bool
    device: str
    gpu_name: str | None = None
    vram_total_mb: int | None = None
    problems: list[str] = Field(default_factory=list)


class GenerationResult(BaseModel):
    job_id: str
    model_name: str
    model_version: str
    options: GenerationOptions
    mesh_path: str
    mesh_format: str
    texture_paths: list[str] = Field(default_factory=list)
    generation_time_ms: int  # 추론만, 모델 로드 제외
    model_load_time_ms: int = 0
    peak_vram_mb: int | None = None
    log_path: str
    warnings: list[str] = Field(default_factory=list)


class ImageTo3DAdapter(ABC):
    """입력은 전처리기가 만든 정사각 RGBA PNG. 배경 제거는 adapter가 하지 않는다 (D-006)."""

    name: str

    @abstractmethod
    def get_model_info(self) -> ModelInfo: ...

    @abstractmethod
    def validate_environment(self) -> EnvironmentStatus: ...

    @abstractmethod
    def generate(
        self, input_rgba: Path, options: GenerationOptions, out_dir: Path, job_id: str
    ) -> GenerationResult: ...
