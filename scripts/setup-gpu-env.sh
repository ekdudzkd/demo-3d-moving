#!/usr/bin/env bash
# GPU 실행 환경 설치 (Linux 또는 WSL2 + NVIDIA 드라이버). Docker 대신 직접 설치할 때 사용.
# 사용: bash scripts/setup-gpu-env.sh [venv 경로]   (기본 ~/.venvs/d2w-gpu)
#
# - PyTorch CUDA 12.4 휠, SAM 2(커밋 고정), TripoSR(커밋 고정 소스), 백엔드를 한 venv에 설치한다.
# - torchmcubes는 CUDA 툴킷 빌드가 필요해 설치하지 않는다. adapter가 scikit-image 기반 대체 모듈을 쓴다 (D-020).
# - 모델 가중치는 첫 실행 때 Hugging Face에서 받아 MODEL_CACHE_DIR(기본 data/models)에 저장한다. 저장소에 커밋하지 않는다.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
VENV=${1:-$HOME/.venvs/d2w-gpu}
TRIPOSR_DIR=${TRIPOSR_DIR:-$HOME/.cache/d2w/TripoSR}
TRIPOSR_COMMIT=107cefdc244c39106fa830359024f6a2f1c78871
SAM2_COMMIT=2b90b9f5ceec907a1c18123530e92e794ad901a4
TORCH_INDEX=https://download.pytorch.org/whl/cu124

command -v uv >/dev/null || { echo "uv가 필요합니다: https://docs.astral.sh/uv/"; exit 1; }
export UV_LINK_MODE=copy

[ -x "$VENV/bin/python" ] || uv venv -q --python 3.11 "$VENV"
echo "▶ PyTorch (CUDA 12.4)"
uv pip install -q -p "$VENV" torch==2.5.1 torchvision==0.20.1 --index-url "$TORCH_INDEX"

echo "▶ 백엔드 + mesh-ready-check"
uv pip install -q -p "$VENV" -e "$ROOT/packages/mesh-ready-check" -e "$ROOT/backend[dev]"

echo "▶ SAM 2 ($SAM2_COMMIT)"
# 빌드 격리를 끄고 venv의 torch를 쓴다. 격리하면 torch(약 2.5GB)를 한 번 더 받는다
uv pip install -q -p "$VENV" setuptools wheel
SAM2_BUILD_CUDA=0 uv pip install -q -p "$VENV" --no-build-isolation "git+https://github.com/facebookresearch/sam2.git@$SAM2_COMMIT"

echo "▶ TripoSR 소스 ($TRIPOSR_COMMIT) → $TRIPOSR_DIR"
if [ ! -d "$TRIPOSR_DIR/.git" ]; then
  git clone -q https://github.com/VAST-AI-Research/TripoSR.git "$TRIPOSR_DIR"
fi
git -C "$TRIPOSR_DIR" fetch -q origin && git -C "$TRIPOSR_DIR" checkout -q "$TRIPOSR_COMMIT"
# TripoSR requirements 중 실제로 쓰는 것만 (rembg·gradio·torchmcubes 제외)
uv pip install -q -p "$VENV" omegaconf==2.3.0 einops==0.7.0 transformers==4.35.0 huggingface-hub scikit-image xatlas==0.0.9 imageio

"$VENV/bin/python" - <<PY
import torch
print("torch", torch.__version__, "cuda", torch.cuda.is_available())
if torch.cuda.is_available():
    free, total = torch.cuda.mem_get_info()
    print("GPU", torch.cuda.get_device_name(0), f"free {free // 2**20} / {total // 2**20} MiB")
PY
cat <<EOF

설치 완료. .env 예시:
  SEGMENTER=sam2
  GENERATOR=triposr
  TRIPOSR_REPO_DIR=$TRIPOSR_DIR
실행: PY=$VENV/bin/python bash scripts/dev-backend.sh
EOF
