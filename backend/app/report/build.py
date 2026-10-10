from __future__ import annotations

import json
from pathlib import Path

from app.core.context import AppContext
from app.db.models import Job
from app.jobs.states import Outcome


def outcome_of(inspect_report: dict) -> Outcome:
    if not inspect_report["is_usable"]:
        return Outcome.NOT_USABLE
    if inspect_report["warnings"]:
        return Outcome.USABLE_WITH_WARNINGS
    return Outcome.USABLE


def build_report(ctx: AppContext, job: Job, job_dir: Path) -> dict:
    repaired = job.result["repair"]["inspect_repaired"]
    report = {
        "job_id": job.id,
        "project_id": job.project_id,
        "outcome": outcome_of(repaired).value,
        "inspect_raw": job.result.get("inspect_raw"),
        "inspect_repaired": repaired,
    }
    (job_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), "utf-8")
    return report
