"""보관 기간(RETENTION_HOURS)이 지난 프로젝트와 파일 삭제."""

from __future__ import annotations

import shutil
from datetime import timedelta

from sqlalchemy import select

from app.core.context import AppContext
from app.db.models import Job, Project, utcnow

from .queue import RUNNING


def cleanup_expired(ctx: AppContext) -> int:
    if ctx.settings.retention_hours <= 0:
        return 0
    cutoff = utcnow() - timedelta(hours=ctx.settings.retention_hours)
    removed = 0
    with ctx.session() as session:
        for project in session.scalars(select(Project)).all():
            created = project.created_at
            if created.tzinfo is None:
                created = created.replace(tzinfo=cutoff.tzinfo)
            if created >= cutoff:
                continue
            busy = session.scalar(
                select(Job.id).where(
                    Job.project_id == project.id, Job.status.in_(RUNNING | {"QUEUED"})
                )
            )
            if busy:
                continue
            shutil.rmtree(ctx.storage.project_dir(project.id), ignore_errors=True)
            session.delete(project)
            removed += 1
        session.commit()
    _cleanup_cache(ctx, cutoff)
    return removed


def _cleanup_cache(ctx: AppContext, cutoff) -> None:
    """SAM 2 임베딩 캐시도 사용자 이미지에서 나온 것이라 같은 기간 뒤 지운다."""
    cache = ctx.settings.data_dir / "cache"
    if not cache.is_dir():
        return
    limit = cutoff.timestamp()
    for path in cache.rglob("*.pt"):
        if path.stat().st_mtime < limit:
            path.unlink(missing_ok=True)
