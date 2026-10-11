# GPU 환경 설치

SAM 2와 TripoSR을 실제로 돌리는 환경. 개발·CI는 Mock으로 충분하고, 이 환경은 GPU 머신 한 대에만 있으면 된다 (D-002, D-004).

## 요구 사항

| 항목 | 값 |
|---|---|
| OS | Linux 또는 Windows 11 + WSL2 (Ubuntu) |
| GPU | NVIDIA, VRAM 8GB 이상 권장 (TripoSR 약 6GB + SAM 2 small 약 1GB, 3-3·3-2에서 실측) |
| 드라이버 | CUDA 12.4 이상을 지원하는 드라이버 (WSL은 Windows 드라이버만 설치, 리눅스 쪽 드라이버 설치 금지) |
| CUDA 툴킷 | **필요 없음** — PyTorch 휠에 런타임 포함, torchmcubes 대신 scikit-image 사용 (D-020) |
| 디스크 | 약 8GB (venv 5GB + 가중치 약 2GB) |

## 방법 1: 직접 설치 (WSL2 권장)

```bash
bash scripts/setup-gpu-env.sh            # ~/.venvs/d2w-gpu
```

`.env`:

```
SEGMENTER=sam2
GENERATOR=triposr
TRIPOSR_REPO_DIR=~/.cache/d2w/TripoSR
```

실행: `PY=~/.venvs/d2w-gpu/bin/python bash scripts/dev-backend.sh`

## 방법 2: Docker

```bash
docker build -f docker/gpu-worker.Dockerfile -t draw2world-gpu .
docker run --gpus all -p 8077:8077 -v d2w-data:/data -v d2w-hf:/root/.cache/huggingface draw2world-gpu
```

> 2026-10-11 기준 두 방법 모두 검증 전. 점검: `python scripts/check_gpu_env.py` (CUDA·SAM 2·TripoSR import·marching cubes), 컨테이너는 `docker run --gpus all --rm draw2world-gpu python scripts/check_gpu_env.py`.

## 가중치

| 모델 | 출처 | 크기 | 위치 |
|---|---|---|---|
| TripoSR | `stabilityai/TripoSR` (Hugging Face) | 약 1.7GB | HF 캐시 |
| SAM 2.1 hiera-small | `facebook/sam2.1-hiera-small` (Hugging Face) | 약 180MB | HF 캐시 |

첫 요청 때 자동으로 받는다. 저장소에는 절대 커밋하지 않는다 (`.gitignore`, CI 금지 파일 검사).

## VRAM이 부족할 때

다른 프로그램(예: 로컬 LLM 서버)이 GPU 메모리를 쓰고 있으면 TripoSR adapter가 남은 VRAM을 확인해 **CPU로 실행**하고 보고서에 기록한다. 느리지만 동작한다. GPU로 돌리려면 해당 프로그램을 종료한다.

## 문제 해결

- `torch.cuda.is_available()`가 False: WSL에서 `nvidia-smi`가 보이는지 확인. 안 보이면 Windows 드라이버 업데이트.
- WSL 디스크가 읽기 전용으로 바뀜(`Read-only file system`, I/O 오류, Bus error, `CreateInstance/E_FAIL`): **Windows C: 여유 공간 부족**이 원인. WSL·Docker 가상 디스크(vhdx)가 늘어나지 못해 ext4가 오류를 낸다. C:에 20GB 이상 확보 → `wsl --shutdown` → 다시 실행. 2026-10-11 C: 여유 0바이트에서 반복 발생.
- uv 설치 중 `Invalid Wheel-Version in WHEEL file: None`: 위 디스크 오류로 uv 캐시 휠이 깨짐. `UV_CACHE_DIR=~/.cache/uv-d2w`처럼 새 캐시로 다시 설치.
- Windows에서 직접 실행 시 numpy DLL 차단: 스마트 앱 컨트롤 때문 (D-013). WSL을 쓴다.
