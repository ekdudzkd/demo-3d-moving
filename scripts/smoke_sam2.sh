#!/usr/bin/env bash
# 3-2 스모크: SEGMENTER=sam2로 서버를 띄워 샘플 3장 업로드(마스크 v1 자동 제안) → 포함점·제외점 누적 재예측 3회.
# 마스크 coverage와 지연(ms)을 표로 출력한다. 첫 실행 때 SAM 2 가중치를 MODEL_CACHE_DIR에 받는다.
# 사용: PY=~/.venvs/d2w-gpu/bin/python bash scripts/smoke_sam2.sh
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PY=${PY:-python}
PORT=${PORT:-8798}
API=http://127.0.0.1:$PORT
export DATA_DIR=$(mktemp -d)
export SEGMENTER=sam2 GENERATOR=mock
export MODEL_CACHE_DIR=${MODEL_CACHE_DIR:-$ROOT/data/models}

cleanup() {
  [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

json() { "$PY" -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
fail() { echo "SMOKE FAIL: $*"; exit 1; }

cd "$ROOT/backend"
"$PY" -m uvicorn app.main:create_app --factory --port "$PORT" >"$DATA_DIR/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 150); do curl -sf "$API/api/health" >/dev/null && break; sleep 0.2; done
curl -sf "$API/api/health" >/dev/null || { cat "$DATA_DIR/server.log"; fail "서버 기동 실패"; }
echo "✓ 서버 기동 (SEGMENTER=sam2)"

printf '%-6s %-4s %-28s %9s %9s\n' sample ver prompts coverage ms
for sample in apple car star; do
  BODY=$(curl -s -F "file=@$ROOT/assets/samples/$sample.png" "$API/api/projects")
  PID=$(echo "$BODY" | json "d.get('id', '')")
  [[ -n "$PID" ]] || { echo "$BODY"; tail -30 "$DATA_DIR/server.log"; fail "$sample 업로드 실패"; }
  echo "$BODY" | "$PY" -c "
import json,sys; m=json.load(sys.stdin)['masks'][-1]
assert m['method']=='sam2', m
assert 0.02 < m['coverage'] < 0.9, m
print(f\"%-6s %-4s %-28s %9.3f %9d\" % ('$sample', 'v1', 'auto box (embed)', m['coverage'], m['elapsed_ms']))"

  # 마스크 중심(포함) → 모서리(제외) → 박스: 매번 누적 프롬프트 전체를 보낸다
  read -r W H CX CY < <("$PY" -c "
from PIL import Image; import numpy as np
im=Image.open('$ROOT/assets/samples/$sample.png'); w,h=im.size
print(w, h, w//2, h//2)")
  P1="{\"x\":$CX,\"y\":$CY,\"label\":1}"
  P2="{\"x\":5,\"y\":5,\"label\":0}"
  i=2
  for body in "{\"points\":[$P1]}" "{\"points\":[$P1,$P2]}" "{\"points\":[$P1,$P2],\"box\":[$((W/8)),$((H/8)),$((W*7/8)),$((H*7/8))]}"; do
    M=$(curl -s -H 'content-type: application/json' -d "$body" "$API/api/projects/$PID/segment")
    echo "$M" | "$PY" -c "
import json,sys; m=json.load(sys.stdin)
assert m['method']=='sam2' and 0.02 < m['coverage'] < 0.9, m
n=len(m['prompts']['points']); b='+box' if m['prompts']['box'] else ''
print(f\"%-6s %-4s %-28s %9.3f %9d\" % ('$sample', 'v$i', f'{n} points{b} (cached)', m['coverage'], m['elapsed_ms']))" \
      || { tail -30 "$DATA_DIR/server.log"; fail "$sample 재예측 실패"; }
    i=$((i + 1))
  done
done
echo "✓ 샘플 3장 SAM 2 분할 + 누적 재예측"
