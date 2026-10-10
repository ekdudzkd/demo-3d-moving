"""백엔드 OpenAPI 스키마를 frontend/openapi.json으로 내보낸다. 프론트 타입 생성의 원본.

사용: python scripts/export_openapi.py   (backend 의존성 설치된 Python)
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.core.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402


def build() -> str:
    with tempfile.TemporaryDirectory() as tmp:
        app = create_app(Settings(_env_file=None, data_dir=Path(tmp)))
        app.state.ctx.engine.dispose()
        return json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"


if __name__ == "__main__":
    out = ROOT / "frontend" / "openapi.json"
    out.write_text(build(), encoding="utf-8")
    print(out)
