from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # backend/에서 실행해도 저장소 루트의 .env를 읽는다
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    data_dir: Path = Path("./data")
    database_url: str = ""  # 비우면 {data_dir}/draw2world.db
    retention_hours: int = 24
    max_upload_mb: int = 10
    min_short_side: int = 512
    max_long_side: int = 2048

    segmenter: Literal["grabcut", "sam2"] = "grabcut"
    generator: str = "mock"
    face_budget: int = 50_000

    sf3d_enabled: bool = False
    sf3d_license_accepted: bool = False

    # 테스트용 실패 주입: oom | timeout | empty | internal
    mock_fail: str = ""
    # Mock 생성 단계 지연 (프론트 진행 화면 확인용)
    mock_delay_ms: int = 0

    worker_poll_seconds: float = 1.0
    cors_origins: list[str] = ["http://localhost:5391", "http://127.0.0.1:5391"]

    # 3단계: 모델 가중치 위치
    model_cache_dir: Path = Path("./data/models")
    sam2_checkpoint: str = "facebook/sam2.1-hiera-small"
    triposr_repo_dir: Path | None = None

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{(self.data_dir / 'draw2world.db').as_posix()}"

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024
