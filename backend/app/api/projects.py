from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.context import AppContext
from app.db.models import Project
from app.input.validate import load_and_validate
from app.jobs.states import ProjectStatus

from .deps import get_ctx, get_session
from .schemas import ProjectOut, RejectedOut
from .serialize import project_out

router = APIRouter(prefix="/api/projects", tags=["projects"])


def get_project_or_404(session: Session, project_id: str) -> Project:
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "프로젝트가 없습니다.")
    return project


@router.post(
    "",
    status_code=201,
    response_model=ProjectOut,
    responses={422: {"model": RejectedOut, "description": "입력 이미지 검사 실패"}},
)
async def create_project(
    file: UploadFile = File(...),
    ctx: AppContext = Depends(get_ctx),
    session: Session = Depends(get_session),
):
    data = await file.read(ctx.settings.max_upload_bytes + 1)
    loaded = load_and_validate(data, ctx.settings)
    if not loaded.result.is_valid:
        # 거부된 이미지는 저장하지 않는다
        body = RejectedOut(validation=loaded.result)
        return JSONResponse(status_code=422, content=body.model_dump(mode="json"))

    project = Project(
        status=ProjectStatus.VALIDATED.value,
        width=loaded.result.width,
        height=loaded.result.height,
        validation=loaded.result.model_dump(mode="json"),
    )
    session.add(project)
    session.flush()

    path = ctx.storage.original(project.id)
    path.parent.mkdir(parents=True, exist_ok=True)
    loaded.image.save(path, format="PNG")
    (path.parent / "validation.json").write_text(
        json.dumps(project.validation, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    session.commit()
    session.refresh(project)
    return project_out(ctx, project)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: str,
    ctx: AppContext = Depends(get_ctx),
    session: Session = Depends(get_session),
):
    return project_out(ctx, get_project_or_404(session, project_id))
