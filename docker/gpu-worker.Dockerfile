# GPU 실행 환경 (API 서버 + 워커). 대형 모델 가중치는 이미지에 넣지 않고 볼륨에 캐시한다.
#
# 빌드:  docker build -f docker/gpu-worker.Dockerfile -t draw2world-gpu .
# 실행:  docker run --gpus all -p 8077:8077 -v d2w-data:/data -v d2w-hf:/root/.cache/huggingface draw2world-gpu
#
# 버전 고정: CUDA 12.4, Python 3.11, torch 2.5.1, TripoSR·SAM 2 커밋 (scripts/setup-gpu-env.sh와 같음)
# torch 휠에 CUDA 런타임·cuDNN이 들어 있어 base 이미지면 충분하다 (cudnn-runtime보다 수 GB 작음)
FROM nvidia/cuda:12.4.1-base-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1 \
    DATA_DIR=/data \
    SEGMENTER=sam2 \
    GENERATOR=triposr \
    TRIPOSR_REPO_DIR=/opt/TripoSR

RUN apt-get update && apt-get install -y --no-install-recommends \
        git curl ca-certificates libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
# uv 설치 스크립트는 버전마다 설치 경로가 달라(~/.cargo/bin, ~/.local/bin) 공식 이미지에서 바이너리만 복사
COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /uvx /usr/local/bin/

WORKDIR /app
COPY packages/mesh-ready-check packages/mesh-ready-check
COPY backend backend
COPY scripts scripts
COPY assets/samples assets/samples

RUN TRIPOSR_DIR=/opt/TripoSR bash scripts/setup-gpu-env.sh /opt/venv
ENV PATH=/opt/venv/bin:$PATH

EXPOSE 8077
CMD ["bash", "-c", "PY=/opt/venv/bin/python bash scripts/dev-backend.sh"]
