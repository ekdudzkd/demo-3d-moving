"""생성 job 단계 실행기.

각 단계는 독립 함수이고 입력·출력을 job 디렉터리의 정해진 파일로 주고받는다.
하나의 함수에서 전체 파이프라인을 처리하지 않는다 (project-brief §6).
"""

from __future__ import annotations

import json
import time
import traceback
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from app.core.context import AppContext
from app.core.errors import ErrorCode, PipelineError
from app.db.models import Job, utcnow
from app.export.build import export_assets
from app.generation.base import GenerationOptions
from app.generation.registry import get_adapter
from app.mesh.inspect import inspect_file
from app.mesh.repair import repair_file
from app.preprocess.normalize import PreprocessOptions, normalize
from app.report.build import build_report
from app.segmentation.service import load_mask, load_original

from .events import add_event
from .states import STAGES, JobStatus


@dataclass
class StageInput:
    ctx: AppContext
    job: Job
    dir: Path

    @property
    def settings(self):
        return self.ctx.settings


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), "utf-8")


def stage_preprocess(s: StageInput) -> dict:
    image = load_original(s.ctx, s.job.project_id)
    mask = load_mask(s.ctx, s.job.project_id, s.job.mask_version)
    opts = PreprocessOptions(**s.job.preprocess_options)
    result = normalize(image, mask, s.dir / "preprocess", opts)
    return {"preprocess": result.model_dump()}


def stage_generate(s: StageInput) -> dict:
    adapter = get_adapter(s.job.generator, s.settings)
    env = adapter.validate_environment()
    if not env.ok:
        raise PipelineError(ErrorCode.MODEL_UNAVAILABLE, "; ".join(env.problems))
    result = adapter.generate(
        s.dir / "preprocess" / "03_normalized.png",
        GenerationOptions(**s.job.options),
        s.dir / "generation",
        s.job.id,
    )
    write_json(s.dir / "generation" / "generation_result.json", result.model_dump())
    return {
        "generation": result.model_dump(),
        "model_info": adapter.get_model_info().model_dump(),
        "environment": env.model_dump(),
    }


def stage_validate(s: StageInput) -> dict:
    report = inspect_file(Path(s.job.result["generation"]["mesh_path"]), s.settings.face_budget)
    write_json(s.dir / "mesh" / "inspect_raw.json", report)
    if report["face_count"] == 0:
        raise PipelineError(ErrorCode.MESH_EMPTY, "생성된 메시에 면이 없음")
    return {"inspect_raw": report}


def stage_repair(s: StageInput) -> dict:
    out = repair_file(
        Path(s.job.result["generation"]["mesh_path"]), s.dir / "mesh", s.settings.face_budget
    )
    return {"repair": out}


def stage_export(s: StageInput) -> dict:
    exported = export_assets(s.ctx, s.job, s.dir)
    return {"export": exported}


STAGE_FUNCS: dict[JobStatus, Callable[[StageInput], dict]] = {
    JobStatus.PREPROCESSING: stage_preprocess,
    JobStatus.GENERATING: stage_generate,
    JobStatus.VALIDATING: stage_validate,
    JobStatus.REPAIRING: stage_repair,
    JobStatus.EXPORTING: stage_export,
}


def run_job(ctx: AppContext, job_id: str) -> str:
    """claim된 job을 끝까지 실행하고 최종 상태를 돌려준다."""
    with ctx.session() as session:
        job = session.get(Job, job_id)
        assert job is not None
        job_dir = ctx.storage.job_dir(job.project_id, job.id)
        job_dir.mkdir(parents=True, exist_ok=True)
        stage_input = StageInput(ctx, job, job_dir)

        for stage in STAGES:
            session.refresh(job)
            if job.cancel_requested:
                return _finish_cancelled(session, job, stage)
            job.status = stage.value
            add_event(session, job.id, stage.value, "enter", f"{stage.value} 시작")
            session.commit()

            started = time.perf_counter()
            try:
                out = STAGE_FUNCS[stage](stage_input)
            except PipelineError as exc:
                return _fail(session, job, stage, exc, job_dir)
            except Exception as exc:  # noqa: BLE001 - 어떤 오류든 단계·로그를 남기고 실패 처리
                wrapped = PipelineError(ErrorCode.INTERNAL, f"{type(exc).__name__}: {exc}")
                (job_dir / "worker.log").write_text(traceback.format_exc(), "utf-8")
                return _fail(session, job, stage, wrapped, job_dir)

            elapsed = round((time.perf_counter() - started) * 1000)
            job.result = {**job.result, **out}  # JSON 컬럼 변경 감지를 위해 새 dict 할당
            add_event(session, job.id, stage.value, "exit", f"{stage.value} 완료", elapsed)
            session.commit()

        report = build_report(ctx, job, job_dir)
        job.outcome = report["outcome"]
        job.result = {**job.result, "report_path": str(job_dir / "report.json")}
        job.status = JobStatus.COMPLETED.value
        job.finished_at = utcnow()
        add_event(session, job.id, JobStatus.COMPLETED.value, "status", f"완료: {job.outcome}")
        session.commit()
        return job.status


def _fail(session, job: Job, stage: JobStatus, exc: PipelineError, job_dir: Path) -> str:
    log = job_dir / "worker.log"
    if not log.exists():
        log.write_text(f"{exc.code.value}: {exc.detail}\n", "utf-8")
    job.error = {
        "stage": stage.value,
        "code": exc.code.value,
        "user_message": exc.user_message,
        "retryable": exc.retryable,
        "detail": exc.detail,
        "log_path": str(log),
        "options": job.options,
    }
    job.status = JobStatus.FAILED.value
    job.finished_at = utcnow()
    add_event(session, job.id, stage.value, "error", f"{exc.code.value}: {exc.user_message}")
    session.commit()
    return job.status


def _finish_cancelled(session, job: Job, stage: JobStatus) -> str:
    job.status = JobStatus.CANCELLED.value
    job.finished_at = utcnow()
    job.error = {
        "stage": stage.value,
        "code": ErrorCode.CANCELLED.value,
        "user_message": "사용자가 작업을 취소했습니다.",
        "retryable": True,
        "detail": "",
    }
    add_event(session, job.id, JobStatus.CANCELLED.value, "status", f"{stage.value} 전에 취소됨")
    session.commit()
    return job.status
