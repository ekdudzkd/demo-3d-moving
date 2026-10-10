from __future__ import annotations

from fastapi import APIRouter, Depends

from app import __version__
from app.core.context import AppContext
from app.generation.registry import describe_all

from .deps import get_ctx

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("")
def health(ctx: AppContext = Depends(get_ctx)) -> dict:
    s = ctx.settings
    return {
        "status": "ok",
        "version": __version__,
        "segmenter": s.segmenter,
        "generator": s.generator,
        "retention_hours": s.retention_hours,
        "max_upload_mb": s.max_upload_mb,
    }


@router.get("/models")
def models(ctx: AppContext = Depends(get_ctx)) -> dict:
    return {"default": ctx.settings.generator, "adapters": describe_all(ctx.settings)}
