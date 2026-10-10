from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.models import Asset

from .deps import get_session

router = APIRouter(prefix="/api/assets", tags=["assets"])


@router.get("/{asset_id}")
def get_asset(asset_id: str, session: Session = Depends(get_session)) -> dict:
    """월드 배치용 자산 정의 (project-brief §14 형식 + 충돌체)."""
    asset = session.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(404, "자산이 없습니다.")
    return asset.data
