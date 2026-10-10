from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.context import AppContext
from app.db.models import Project
from app.input.validate import load_and_validate
from app.jobs.states import ProjectStatus
from app.segmentation.base import Prompts
from app.segmentation.service import propose_mask

from .deps import get_ctx, get_session
from .schemas import ConfirmIn, MaskOut, ProjectOut, RejectedOut, SegmentIn
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
    # 시스템이 먼저 주 객체를 찾아 마스크 v1을 제안한다. 사용자는 화면 2에서 확인·수정
    propose_mask(ctx, session, project, Prompts())
    session.commit()
    return project_out(ctx, project)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: str,
    ctx: AppContext = Depends(get_ctx),
    session: Session = Depends(get_session),
):
    return project_out(ctx, get_project_or_404(session, project_id))


@router.post("/{project_id}/segment", status_code=201, response_model=MaskOut)
def segment(
    project_id: str,
    body: SegmentIn,
    ctx: AppContext = Depends(get_ctx),
    session: Session = Depends(get_session),
):
    project = get_project_or_404(session, project_id)
    for p in body.points:
        if not (0 <= p.x < project.width and 0 <= p.y < project.height):
            raise HTTPException(422, "점이 이미지 밖에 있습니다.")
    box = None
    if body.box is not None:
        if len(body.box) != 4:
            raise HTTPException(422, "box는 [x0, y0, x1, y1] 형식이어야 합니다.")
        x0, y0, x1, y1 = body.box
        box = (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
    prompts = Prompts(points=[(p.x, p.y, p.label) for p in body.points], box=box)
    propose_mask(ctx, session, project, prompts)
    session.commit()
    return project_out(ctx, project).masks[-1]


@router.post("/{project_id}/mask/confirm", response_model=ProjectOut)
def confirm_mask(
    project_id: str,
    body: ConfirmIn,
    ctx: AppContext = Depends(get_ctx),
    session: Session = Depends(get_session),
):
    project = get_project_or_404(session, project_id)
    if not project.masks:
        raise HTTPException(409, "확정할 마스크가 없습니다.")
    version = body.version or project.masks[-1].version
    mask = next((m for m in project.masks if m.version == version), None)
    if mask is None:
        raise HTTPException(404, "해당 버전의 마스크가 없습니다.")
    if mask.coverage < 0.01:
        raise HTTPException(422, "마스크가 비어 있습니다. 객체를 다시 선택해 주세요.")
    project.confirmed_mask_version = version
    project.status = ProjectStatus.MASK_CONFIRMED.value
    session.commit()
    return project_out(ctx, project)
