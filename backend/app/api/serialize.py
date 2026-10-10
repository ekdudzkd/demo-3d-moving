from __future__ import annotations

from app.core.context import AppContext
from app.db.models import Project

from .schemas import MaskOut, ProjectOut


def project_out(ctx: AppContext, p: Project) -> ProjectOut:
    st = ctx.storage
    return ProjectOut(
        id=p.id,
        status=p.status,
        width=p.width,
        height=p.height,
        validation=p.validation,
        original_url=st.url(st.original(p.id)),
        masks=[
            MaskOut(
                version=m.version,
                method=m.method,
                coverage=m.coverage,
                url=st.url(st.mask(p.id, m.version)),
                prompts=m.prompts,
                elapsed_ms=m.elapsed_ms,
            )
            for m in p.masks
        ],
        confirmed_mask_version=p.confirmed_mask_version,
        job_ids=[j.id for j in p.jobs],
        created_at=p.created_at,
    )
