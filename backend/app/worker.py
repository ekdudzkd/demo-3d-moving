"""생성 job 워커. 동시성 1 (GPU 1장 기준, D-002).

사용: python -m app.worker [--once]
"""

from __future__ import annotations

import argparse
import logging
import time

from app.core.config import Settings
from app.core.context import AppContext, build_context
from app.edit.versions import claim_next_version, recover_stale_versions, run_version
from app.jobs.pipeline import run_job
from app.jobs.queue import claim_next, recover_stale
from app.jobs.retention import cleanup_expired

log = logging.getLogger("worker")
CLEANUP_INTERVAL_SECONDS = 600


def run_pending(ctx: AppContext) -> int:
    """대기 중인 생성 job과 편집 버전을 모두 처리하고 처리한 개수를 돌려준다."""
    count = 0
    while True:
        with ctx.session() as session:
            job = claim_next(session)
            job_id = job.id if job else None
            version_id = None if job_id else claim_next_version(session)
        if job_id is not None:
            log.info("job %s 시작", job_id)
            status = run_job(ctx, job_id)
            log.info("job %s → %s", job_id, status)
        elif version_id is not None:
            status = run_version(ctx, version_id)
            log.info("편집 버전 %s → %s", version_id, status)
        else:
            return count
        count += 1


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="app.worker")
    parser.add_argument("--once", action="store_true", help="대기열을 비우고 종료")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")

    ctx = build_context(Settings())
    with ctx.session() as session:
        if n := recover_stale(session):
            log.warning("중단된 job %d개를 실패 처리", n)
        if n := recover_stale_versions(session):
            log.warning("중단된 편집 버전 %d개를 실패 처리", n)
    log.info("워커 시작 generator=%s segmenter=%s", ctx.settings.generator, ctx.settings.segmenter)

    last_cleanup = 0.0
    while True:
        if time.monotonic() - last_cleanup > CLEANUP_INTERVAL_SECONDS:
            if removed := cleanup_expired(ctx):
                log.info("보관 기간이 지난 프로젝트 %d개 삭제", removed)
            last_cleanup = time.monotonic()
        processed = run_pending(ctx)
        if args.once:
            return
        if not processed:
            time.sleep(ctx.settings.worker_poll_seconds)


if __name__ == "__main__":
    main()
