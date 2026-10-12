from __future__ import annotations

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from .models import Base


def make_engine(url: str) -> Engine:
    connect_args = {"check_same_thread": False, "timeout": 30} if url.startswith("sqlite") else {}
    engine = create_engine(url, connect_args=connect_args)

    if url.startswith("sqlite"):
        # API 서버와 워커가 같은 파일을 동시에 쓰므로 WAL + busy timeout
        @event.listens_for(engine, "connect")
        def _pragma(dbapi_conn, _):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA busy_timeout=30000")
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()

    _create_tables(engine)
    return engine


def make_sessionmaker(engine: Engine) -> sessionmaker:
    return sessionmaker(engine, expire_on_commit=False)


def _create_tables(engine: Engine) -> None:
    if engine.dialect.name != "sqlite":
        Base.metadata.create_all(engine)
        return
    # 새 DB에서 API 서버와 워커가 동시에 시작하면 서로 checkfirst 검사 후 같은 테이블을 만들려다
    # "already exists"로 실패한다. 배타 잠금 안에서 검사·생성해 직렬화한다(대기는 busy_timeout).
    with engine.connect() as conn:
        conn.exec_driver_sql("BEGIN EXCLUSIVE")
        Base.metadata.create_all(conn)
        conn.commit()
