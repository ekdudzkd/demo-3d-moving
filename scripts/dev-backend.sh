#!/usr/bin/env bash
# 개발용 백엔드 실행: API 서버(:8077) + 생성 워커. Ctrl-C로 둘 다 종료.
# 사용: PY=.venv/bin/python bash scripts/dev-backend.sh
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PY=${PY:-python}
PORT=${PORT:-8077}
cd "$ROOT/backend"
"$PY" -m uvicorn app.main:create_app --factory --host 0.0.0.0 --port "$PORT" &
API_PID=$!
"$PY" -m app.worker &
WORKER_PID=$!
trap 'kill $API_PID $WORKER_PID 2>/dev/null; wait' INT TERM EXIT
echo "API http://localhost:$PORT/docs · 워커 실행 중 (Ctrl-C로 종료)"
wait
