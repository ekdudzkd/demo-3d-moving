"""편집 버전 API (docs/designs/view-and-edit.md 세부 규약, D-027).

계획(화면 op → 월드 op, 범위·no-op 검사)은 요청 안에서 동기로 하고,
메시 적용(합성 → QC → GLB → 충돌체)은 워커가 비동기로 한다.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.context import AppContext
from app.db.models import Asset, AssetVersion, Job
from app.edit.basis import Panel
from app.edit.compose import resolve
from app.edit.ops import ScreenOp
from app.edit.versions import (
    EditConflict,
    active_version,
    add_edit,
    add_revert,
    add_undo,
    in_progress,
    load_v0,
)

from .deps import get_ctx, get_session

router = APIRouter(prefix="/api/assets", tags=["edits"])

SSE_POLL_SECONDS = 0.5
SSE_HEARTBEAT_SECONDS = 15


class EditIn(BaseModel):
    panel: Panel
    text: str = ""
    ops: list[ScreenOp] | None = Field(
        None, description="화면 기준 op. 없으면 text를 플래너가 해석"
    )


class RevertIn(BaseModel):
    to_version: int


class EditPlanOut(BaseModel):
    kind: Literal["refuse", "clarify", "noop"]
    message: str
    reason_code: str | None = None


class EditQueuedOut(BaseModel):
    kind: Literal["ops"] = "ops"
    version: int
    ops: list[dict[str, Any]]
    notes: list[str] = Field(default_factory=list)


class VersionOut(BaseModel):
    version: int
    status: str
    kind: str
    ops: list[dict[str, Any]]
    intent: dict[str, Any]
    prev_state: int | None
    mesh_url: str | None = None
    collision_type: str | None = None
    bounds: list[list[float]] | None = None
    qc: dict[str, Any] | None = None
    error: dict[str, Any] | None = None


class EditsOut(BaseModel):
    asset_id: str
    view_label: str
    active_version: int
    can_undo: bool
    in_progress: int | None
    versions: list[VersionOut]


def get_asset_or_404(session: Session, asset_id: str) -> Asset:
    asset = session.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(404, "자산이 없습니다.")
    return asset


def conflict(exc: EditConflict) -> JSONResponse:
    return JSONResponse(status_code=409, content={"code": exc.code, "detail": exc.message})


def version_out(v: AssetVersion) -> VersionOut:
    r = v.result or {}
    collider = r.get("collider") or {}
    return VersionOut(
        version=v.version,
        status=v.status,
        kind=v.kind,
        ops=v.ops,
        intent=v.intent,
        prev_state=v.prev_state,
        mesh_url=r.get("mesh_url"),
        collision_type=collider.get("type"),
        bounds=r.get("bounds"),
        qc=r.get("qc"),
        error={k: val for k, val in v.error.items() if k != "trace"} if v.error else None,
    )


@router.get("/{asset_id}/edits", response_model=EditsOut)
def list_edits(asset_id: str, session: Session = Depends(get_session)):
    asset = get_asset_or_404(session, asset_id)
    active = active_version(session, asset)
    busy = in_progress(session, asset.id)
    return EditsOut(
        asset_id=asset.id,
        view_label=asset.data.get("view_label", "front"),
        active_version=active.version,
        can_undo=active.prev_state is not None,
        in_progress=busy.version if busy else None,
        versions=[version_out(v) for v in asset.versions],
    )


@router.post(
    "/{asset_id}/edits",
    status_code=202,
    response_model=EditQueuedOut,
    responses={200: {"model": EditPlanOut}, 409: {"description": "진행 중인 편집이 있음"}},
)
def create_edit(asset_id: str, body: EditIn, session: Session = Depends(get_session)):
    asset = get_asset_or_404(session, asset_id)
    if body.ops is None:
        raise HTTPException(422, "ops가 필요합니다.")
    if busy := in_progress(session, asset.id):
        return conflict(
            EditConflict("edit_in_progress", f"e{busy.version} 편집을 처리하는 중이에요.")
        )
    active = active_version(session, asset)
    job = session.get(Job, asset.job_id)
    res = resolve(body.ops, body.panel, active.ops, load_v0(job))
    if res.kind != "ops":
        out = EditPlanOut(kind=res.kind, message=res.message, reason_code=res.reason_code)
        return JSONResponse(status_code=200, content=out.model_dump())
    intent = {
        "panel": body.panel,
        "text": body.text,
        "screen_ops": [op.model_dump() for op in body.ops],
        "notes": res.notes,
    }
    try:
        v = add_edit(session, asset, res.ops, intent)
    except EditConflict as exc:
        return conflict(exc)
    session.commit()
    return EditQueuedOut(version=v.version, ops=res.ops, notes=res.notes)


@router.post("/{asset_id}/edits/undo", status_code=202, response_model=VersionOut)
def undo(asset_id: str, session: Session = Depends(get_session)):
    asset = get_asset_or_404(session, asset_id)
    try:
        v = add_undo(session, asset)
    except EditConflict as exc:
        return conflict(exc)
    session.commit()
    return version_out(v)


@router.post("/{asset_id}/edits/revert", status_code=202, response_model=VersionOut)
def revert(asset_id: str, body: RevertIn, session: Session = Depends(get_session)):
    asset = get_asset_or_404(session, asset_id)
    try:
        v = add_revert(session, asset, body.to_version)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except EditConflict as exc:
        return conflict(exc)
    session.commit()
    return version_out(v)


@router.get("/{asset_id}/events")
async def events(asset_id: str, request: Request, ctx: AppContext = Depends(get_ctx)):
    """편집 버전 상태 SSE. edit_ready·edit_failed·active_version_changed.

    follow=0이면 진행 중인 편집이 없을 때 스트림을 닫는다(테스트·폴링용).
    """
    with ctx.session() as session:
        get_asset_or_404(session, asset_id)
    follow = request.query_params.get("follow", "1") != "0"

    def snapshot() -> tuple[dict[int, str], int]:
        with ctx.session() as session:
            rows = session.execute(
                select(AssetVersion.version, AssetVersion.status).where(
                    AssetVersion.asset_id == asset_id
                )
            ).all()
            active = session.get(Asset, asset_id).data.get("active_version", 0)
        return {v: s for v, s in rows}, active

    async def stream():
        seen, active = snapshot()
        idle = 0.0
        yield "retry: 2000\n\n"
        yield f"event: state\ndata: {json.dumps({'active_version': active})}\n\n"
        while True:
            now, now_active = snapshot()
            for version, status in sorted(now.items()):
                if seen.get(version) != status and status in ("ready", "failed"):
                    name = "edit_ready" if status == "ready" else "edit_failed"
                    yield f"event: {name}\ndata: {json.dumps({'version': version})}\n\n"
                    idle = 0.0
            if now_active != active:
                payload = json.dumps({"active_version": now_active})
                yield f"event: active_version_changed\ndata: {payload}\n\n"
            seen, active = now, now_active
            if not follow and not any(s in ("pending", "running") for s in now.values()):
                yield "event: end\ndata: {}\n\n"
                return
            if await request.is_disconnected():
                return
            await asyncio.sleep(SSE_POLL_SECONDS)
            idle += SSE_POLL_SECONDS
            if idle >= SSE_HEARTBEAT_SECONDS:
                idle = 0.0
                yield ": heartbeat\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
