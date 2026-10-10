"""API 서버와 워커가 공유하는 실행 컨텍스트 (설정, DB, 파일 저장소)."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.session import make_engine, make_sessionmaker

from .config import Settings
from .storage import Storage


@dataclass
class AppContext:
    settings: Settings
    engine: Engine
    sessions: sessionmaker
    storage: Storage

    def session(self) -> Session:
        return self.sessions()


def build_context(settings: Settings | None = None) -> AppContext:
    settings = settings or Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    engine = make_engine(settings.resolved_database_url)
    return AppContext(settings, engine, make_sessionmaker(engine), Storage(settings.data_dir))
