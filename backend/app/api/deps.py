from __future__ import annotations

from collections.abc import Iterator

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.context import AppContext


def get_ctx(request: Request) -> AppContext:
    return request.app.state.ctx


def get_session(ctx: AppContext = Depends(get_ctx)) -> Iterator[Session]:
    with ctx.session() as session:
        yield session
