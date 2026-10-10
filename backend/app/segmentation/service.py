from __future__ import annotations

import json
import time

import numpy as np
from PIL import Image
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.context import AppContext
from app.db.models import Mask, Project
from app.jobs.states import ProjectStatus

from .base import Prompts, Segmenter
from .postprocess import refine_mask


def get_segmenter(settings: Settings) -> Segmenter:
    if settings.segmenter == "sam2":
        from .sam2 import Sam2Segmenter  # GPU 환경에서만 import

        return Sam2Segmenter.shared(settings)
    from .grabcut import GrabCutSegmenter

    return GrabCutSegmenter()


def load_original(ctx: AppContext, project_id: str) -> np.ndarray:
    return np.asarray(Image.open(ctx.storage.original(project_id)))


def load_mask(ctx: AppContext, project_id: str, version: int) -> np.ndarray:
    return np.asarray(Image.open(ctx.storage.mask(project_id, version))) >= 128


def propose_mask(ctx: AppContext, session: Session, project: Project, prompts: Prompts) -> Mask:
    image = load_original(ctx, project.id)
    segmenter = get_segmenter(ctx.settings)
    started = time.perf_counter()
    raw = segmenter.segment(image, prompts)
    mask = refine_mask(raw, prompts)
    elapsed_ms = round((time.perf_counter() - started) * 1000)

    version = (max((m.version for m in project.masks), default=0)) + 1
    path = ctx.storage.mask(project.id, version)
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(mask.astype(np.uint8) * 255, "L").save(path)
    ctx.storage.mask_prompts(project.id, version).write_text(
        json.dumps({"method": segmenter.name, **prompts.to_dict()}, ensure_ascii=False),
        encoding="utf-8",
    )

    record = Mask(
        project_id=project.id,
        version=version,
        method=segmenter.name,
        coverage=round(float(mask.mean()), 4),
        prompts=prompts.to_dict(),
        elapsed_ms=elapsed_ms,
    )
    project.masks.append(record)
    project.status = ProjectStatus.MASK_PROPOSED.value
    project.confirmed_mask_version = None
    session.flush()
    return record
