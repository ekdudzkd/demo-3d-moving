from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.core.context import AppContext

from .deps import get_ctx

router = APIRouter(prefix="/api/files", tags=["files"])

MEDIA_TYPES = {
    ".glb": "model/gltf-binary",
    ".obj": "text/plain",
    ".json": "application/json",
    ".png": "image/png",
}


@router.get("/{path:path}")
def get_file(path: str, ctx: AppContext = Depends(get_ctx)) -> FileResponse:
    target = ctx.storage.resolve_public(path)
    if target is None:
        raise HTTPException(404, "파일이 없습니다.")
    return FileResponse(target, media_type=MEDIA_TYPES.get(target.suffix.lower()))
