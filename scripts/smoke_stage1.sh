#!/usr/bin/env bash
# 1단계 스모크: API 서버 + 워커를 실제로 띄워 업로드 → 마스크 → 생성 → 보고서까지 확인한다.
# 사용: PY=python bash scripts/smoke_stage1.sh   (backend 의존성이 설치된 Python)
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PY=${PY:-python}
PORT=${PORT:-8799}
API=http://127.0.0.1:$PORT
export DATA_DIR=$(mktemp -d)
export GENERATOR=mock SEGMENTER=grabcut MOCK_FAIL= MOCK_DELAY_MS=0

cleanup() {
  [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

json() { "$PY" -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
check() { "$PY" -c "import json,sys; d=json.load(sys.stdin)
$1"; }
fail() { echo "SMOKE FAIL: $*"; exit 1; }

cd "$ROOT/backend"
"$PY" -m uvicorn app.main:create_app --factory --port "$PORT" >"$DATA_DIR/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 150); do curl -sf "$API/api/health" >/dev/null && break; sleep 0.2; done
curl -sf "$API/api/health" >/dev/null || { cat "$DATA_DIR/server.log"; fail "서버 기동 실패"; }
echo "✓ 서버 기동"

run_job() {  # $1 = 샘플 이름, 나머지 = 워커 환경 변수
  local sample=$1; shift
  local pid job
  pid=$(curl -sf -F "file=@$ROOT/assets/samples/$sample.png" "$API/api/projects" | json "d['id']")
  curl -sf -H 'content-type: application/json' -d '{}' "$API/api/projects/$pid/mask/confirm" >/dev/null
  job=$(curl -sf -H 'content-type: application/json' -d '{}' "$API/api/projects/$pid/jobs" | json "d['id']")
  env "$@" "$PY" -m app.worker --once >>"$DATA_DIR/worker.log" 2>&1
  echo "$job"
}

# 정상 흐름
JOB=$(run_job apple)
BODY=$(curl -sf "$API/api/jobs/$JOB")
STATUS=$(echo "$BODY" | json "d['status']")
[[ "$STATUS" == COMPLETED ]] || { echo "$BODY"; fail "job 상태 $STATUS"; }
echo "✓ job 완료 ($(echo "$BODY" | json "d['outcome']"))"

for key in input_normalized raw_mesh raw_glb repaired_glb asset collider report inspect_raw inspect_repaired repair_steps; do
  url=$(echo "$BODY" | json "d['files'].get('$key', '')")
  [[ -n "$url" ]] || fail "산출물 없음: $key"
  curl -sf -o /dev/null "$API$url" || fail "산출물 다운로드 실패: $key"
done
echo "✓ 산출물 10종 다운로드"

REPORT_URL=$(echo "$BODY" | json "d['files']['report']")
curl -sf "$API$REPORT_URL" | check "
assert d['schema_version'] == '1.0'
assert d['outcome'] in ('USABLE', 'USABLE_WITH_WARNINGS', 'NOT_USABLE')
assert d['quality']['repaired']['grounded'] and d['quality']['repaired']['centered']
assert [t['stage'] for t in d['timings']['stages']] == ['PREPROCESSING','GENERATING','VALIDATING','REPAIRING','EXPORTING']
assert d['disclaimer']" || fail "보고서 스키마"
echo "✓ 보고서 스키마"

ASSET=$(echo "$BODY" | json "d['asset_id']")
curl -sf "$API/api/assets/$ASSET" | json "d['collision_type']" >/dev/null || fail "asset"
echo "✓ asset.json"

curl -sN --max-time 10 "$API/api/jobs/$JOB/events" | grep -q "event: end" || fail "SSE 종료 이벤트 없음"
echo "✓ SSE"

# 실패 주입
JOB=$(run_job star MOCK_FAIL=oom)
curl -sf "$API/api/jobs/$JOB" | check "
assert d['status'] == 'FAILED', d['status']
assert d['error']['code'] == 'CUDA_OOM' and d['error']['retryable'] and d['error']['stage'] == 'GENERATING'" || fail "실패 주입"
echo "✓ 실패 주입 (CUDA_OOM, retryable)"

echo "SMOKE STAGE 1 OK"
