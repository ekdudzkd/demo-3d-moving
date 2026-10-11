#!/usr/bin/env bash
# 3-3 스모크: SEGMENTER=sam2 GENERATOR=triposr로 서버를 띄워 샘플 3장 업로드 → 마스크 확정 → job 생성
# (+ 자동차는 텍스처 베이크 job 하나 더) → 워커 1회 실행(모델 1번 로드) → 측정값 표 출력.
# 사용: PY=~/.venvs/d2w-gpu/bin/python MODEL_CACHE_DIR=~/.cache/d2w/models bash scripts/smoke_triposr.sh
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PY=${PY:-python}
PORT=${PORT:-8797}
API=http://127.0.0.1:$PORT
export DATA_DIR=$(mktemp -d)
export SEGMENTER=sam2 GENERATOR=triposr MOCK_FAIL=
export MODEL_CACHE_DIR=${MODEL_CACHE_DIR:-$ROOT/data/models}
KEEP=${KEEP:-}  # 비우지 않으면 DATA_DIR을 지우지 않는다 (산출물 확인용)

cleanup() {
  [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null || true
  if [[ -n "$KEEP" ]]; then echo "산출물: $DATA_DIR"; else rm -rf "$DATA_DIR"; fi
}
trap cleanup EXIT

json() { "$PY" -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
fail() { echo "SMOKE FAIL: $*"; exit 1; }
post() { curl -sf -H 'content-type: application/json' -d "$2" "$API$1"; }

cd "$ROOT/backend"
"$PY" -m uvicorn app.main:create_app --factory --port "$PORT" >"$DATA_DIR/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 150); do curl -sf "$API/api/health" >/dev/null && break; sleep 0.2; done
curl -sf "$API/api/health" >/dev/null || { cat "$DATA_DIR/server.log"; fail "서버 기동 실패"; }
echo "✓ 서버 기동 (SEGMENTER=sam2 GENERATOR=triposr)"

curl -sf "$API/api/health/models" | "$PY" -c "
import json,sys; d={a['name']:a for a in json.load(sys.stdin)['adapters']}
t=d['triposr']; assert t['enabled'] and t['environment']['ok'], t
print('✓ /api/health/models triposr ok:', t['environment']['gpu_name'], t['environment']['vram_total_mb'], 'MiB')"

JOBS=()
for sample in apple car star; do
  PID=$(curl -sf -F "file=@$ROOT/assets/samples/$sample.png" "$API/api/projects" | json "d['id']")
  post "/api/projects/$PID/mask/confirm" '{}' >/dev/null
  JOBS+=("$sample:$(post "/api/projects/$PID/jobs" '{}' | json "d['id']")")
  if [[ $sample == car ]]; then
    JOBS+=("car+bake:$(post "/api/projects/$PID/jobs" '{"options":{"bake_texture":true}}' | json "d['id']")")
  fi
done
echo "✓ job ${#JOBS[@]}개 생성 → 워커 실행"
"$PY" -m app.worker --once >"$DATA_DIR/worker.log" 2>&1 || { tail -30 "$DATA_DIR/worker.log"; fail "워커 오류"; }

printf '%-9s %-22s %7s %7s %8s %8s %6s %4s %s\n' sample outcome raw_f rep_f gen_ms load_ms vram mc bake
for entry in "${JOBS[@]}"; do
  name=${entry%%:*} job=${entry#*:}
  BODY=$(curl -sf "$API/api/jobs/$job")
  [[ $(echo "$BODY" | json "d['status']") == COMPLETED ]] || { echo "$BODY"; fail "$name job 실패"; }
  curl -sf "$API$(echo "$BODY" | json "d['files']['report']")" | "$PY" -c "
import json,sys; d=json.load(sys.stdin); m=d['model']; t=d['timings']; q=d['quality']
assert m['name']=='triposr' and q['raw']['face_count']>0, m
print(f\"%-9s %-22s %7d %7d %8d %8d %6s %4d %s\" % ('$name', d['outcome'], q['raw']['face_count'], q['repaired']['face_count'],
  t['generation_ms'], t['model_load_ms'], t['peak_vram_mb'], m['options']['mc_resolution'], m['options']['bake_texture']))
for w in m['warnings']: print('          경고:', w)" || fail "$name 보고서 확인 실패"
  if [[ $name == car+bake ]]; then
    dir=$(ls -d "$DATA_DIR"/projects/*/jobs/"$job")
    [[ -s $dir/generation/texture.png ]] || fail "텍스처 파일 없음"
    echo "          texture.png $("$PY" -c "from PIL import Image; print(Image.open('$dir/generation/texture.png').size)")"
  fi
done
echo "✓ 샘플 3장 TripoSR 생성 → raw.obj → 검사·보정·GLB 완료"
