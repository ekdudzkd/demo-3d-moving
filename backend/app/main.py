from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api import assets, edits, files, health, jobs, projects
from app.core.config import Settings
from app.core.context import build_context


def create_app(settings: Settings | None = None) -> FastAPI:
    ctx = build_context(settings)
    app = FastAPI(title="Draw2World AI", version=__version__)
    app.state.ctx = ctx
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ctx.settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    for module in (health, files, projects, jobs, assets, edits):
        app.include_router(module.router)
    return app
