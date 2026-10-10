#!/usr/bin/env bash
# 커밋되면 안 되는 파일(비밀, 가중치, 사용자 이미지, 대형 파일)이 추적되고 있는지 검사한다.
# 사용: bash scripts/check_forbidden_files.sh   (실패 시 exit 1)
set -euo pipefail

MAX_BYTES=$((5 * 1024 * 1024))
# 이미지가 허용되는 경로 (팀 제작 공개 샘플, 데모 월드 텍스처, 프론트 정적 파일)
IMAGE_ALLOW='^(assets/samples/|assets/demo-world/|frontend/public/)'

fail=0
report() { echo "FORBIDDEN: $1 ($2)"; fail=1; }

while IFS= read -r -d '' f; do
  case "$f" in
    .env.example) ;;
    .env|.env.*) report "$f" "환경 변수 파일" ;;
    data/*|evals/input-images/*|evals/segmentation-labels/*|evals/generation-results/*)
      report "$f" "런타임·평가 데이터" ;;
    *.ckpt|*.pt|*.pth|*.safetensors|*.onnx) report "$f" "모델 가중치" ;;
  esac

  case "${f,,}" in
    *.png|*.jpg|*.jpeg|*.webp)
      [[ "$f" =~ $IMAGE_ALLOW ]] || report "$f" "허용 경로 밖 이미지" ;;
  esac

  if [[ -f "$f" ]]; then
    size=$(wc -c < "$f")
    (( size > MAX_BYTES )) && report "$f" "5MB 초과 (${size} bytes)"
  fi
done < <(git ls-files -z)

if (( fail )); then
  echo "금지 파일 검사 실패"
  exit 1
fi
echo "금지 파일 검사 통과"
