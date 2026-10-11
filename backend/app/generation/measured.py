"""최근 완료 job에서 생성기별 실측값을 모은다 (/api/health/models)."""

from __future__ import annotations

import statistics

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Job

RECENT = 20


def measured_stats(session: Session, generator: str) -> dict | None:
    jobs = session.scalars(
        select(Job)
        .where(Job.generator == generator, Job.status == "COMPLETED")
        .order_by(Job.finished_at.desc())
        .limit(RECENT)
    ).all()
    gen_ms, vram, usable = [], [], 0
    for job in jobs:
        g = (job.result or {}).get("generation") or {}
        if g.get("generation_time_ms") is not None:
            gen_ms.append(g["generation_time_ms"])
        if g.get("peak_vram_mb") is not None:
            vram.append(g["peak_vram_mb"])
        if job.outcome in ("USABLE", "USABLE_WITH_WARNINGS"):
            usable += 1
    if not jobs:
        return None
    return {
        "recent_jobs": len(jobs),
        "usable": usable,
        "generation_ms_median": round(statistics.median(gen_ms)) if gen_ms else None,
        "generation_ms_max": max(gen_ms) if gen_ms else None,
        "peak_vram_mb_max": max(vram) if vram else None,
    }
