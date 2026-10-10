# Draw2World AI — 오피스 아워 제안서 (v1, 2026-10-11)

`docs/project-brief.md` §26 "첫 번째 작업 지시" 13개 항목에 대한 제안. 모든 항목은 **추천안으로 확정**한 상태이며, 근거는 `docs/decision-log.md`에 기록한다. 구현 순서는 `docs/build-plan.md`.

> 수치(VRAM, 시간, 임계값)는 공개 문서 기준 **추정치**다. 1단계·3단계에서 실측 후 이 문서를 갱신한다.

---

## 0. 원안 검토 — 바꾼 것

| # | 원안 | 문제 | 추천 (확정) |
|---|---|---|---|
| R1 | 작업 상태에 `SEGMENTING` 포함 | 분할은 사용자 확인이 필요한 **대화형** 단계. 비동기 job 안에 넣으면 job이 사용자 입력을 기다리며 멈춤 | **Project(대화형) / GenerationJob(비동기) 분리**. 분할은 Project 단계, Job은 마스크 확정 후 시작 |
| R2 | Adapter 인터페이스가 TS 문법 | 생성은 백엔드(Python)에서 실행 | Python `ABC` + Pydantic 모델로 정의 |
| R3 | Celery 또는 간단한 큐 | GPU 1장 = 동시 실행 1개. Celery+Redis는 과함 | **SQLite job 테이블 + 별도 워커 프로세스 1개**(폴링·원자적 claim). Redis 없음 |
| R4 | Python 3.12 단일 환경 | TripoSR의 `torchmcubes`는 CUDA 소스 빌드, 3.12·Windows에서 빌드 실패 사례 잦음 | API는 3.12. **GPU 워커는 별도 환경(Docker 또는 WSL2, Python 3.10/3.11 허용)** |
| R5 | `workers/` 3개 폴더 + `backend/app/*` 중복 | 같은 로직이 두 곳에 생김 | 로직은 `backend/app/<stage>/`에만. 워커는 `python -m app.worker` 하나 |
| R6 | mesh-ready-check를 "후보"로 둠 | 나중에 떼어내기 어려움 | 처음부터 **`packages/mesh-ready-check/` 독립 패키지**(자체 pyproject, 백엔드가 의존) |
| R7 | 3D 처리에 PyMeshLab 포함 | **PyMeshLab은 GPL-3.0**. MIT로 공개할 mesh-ready-check에 import하면 라이선스 충돌 | 핵심은 trimesh(MIT)만. PyMeshLab·Blender는 **선택적 외부 프로세스**로만 사용 |
| R8 | 평가 이미지 `evals/input-images/` 저장소 내 | 아동 그림·사용자 이미지 커밋 금지 원칙과 충돌 | 저장소엔 `manifest.csv` + 체크섬만. 원본은 비공개 저장소(팀 드라이브). 공개 샘플은 팀이 그린 CC0 5장만 |

---

## 1. MVP 입력 이미지 조건

| 항목 | 기준 | 위반 시 |
|---|---|---|
| 형식 | PNG, JPG, WEBP (매직바이트로 판별, 확장자 무시) | 거부 |
| 파일 크기 | ≤ 10 MB (`MAX_UPLOAD_MB`) | 거부 |
| 해상도 | 짧은 변 ≥ 512px. 긴 변 > 2048px이면 2048로 축소 저장 | < 512 거부 |
| EXIF | 회전 적용 후 **EXIF 전부 제거**(위치정보 등 개인정보) | — |
| 투명 배경 | 알파 채널 있으면 알파를 초기 마스크로 사용. 알파가 전부 255/0이면 "투명 영역 이상" 경고 | 경고 |
| 객체 수 | 초기 전경 마스크의 유의미 연결성분(면적 ≥ 전경의 5%) 수 | ≥ 2 경고 |
| 객체 크기 | coverage = 전경 픽셀 / 전체 | < 5% 거부, < 10% 경고, > 90% 경고 |
| 잘림 | 전경 bbox가 이미지 테두리 1% 이내에 닿은 변 수 | ≥ 1 경고 |
| 중앙성 | bbox 중심과 이미지 중심 거리 / 대각선 | > 0.25 경고 |
| 흐림 | 그레이스케일 Laplacian 분산 | < 임계값 경고 (임계값은 평가셋으로 튜닝, 초기 50) |
| 배경 유사색 | 전경/배경 평균색 Lab ΔE | < 15 경고 |

초기 전경 마스크(검사용)는 SAM 없이 OpenCV로 계산: 알파 → 없으면 "흰 종이" 가정 Otsu 임계 + morphology. 검사는 GPU 없이 즉시 응답.

사용자 촬영 가이드(업로드 화면): 흰 종이 · 위에서 정면 · 그림자 최소 · **윤곽선 굵게, 안쪽 색칠** · 그림 하나만.

응답 스키마는 원안 §7 + `warnings: [{code, message}]`, `errors: [...]`.

---

## 2. TripoSR 실행 환경과 GPU 요구사항

- **라이선스**: 코드·가중치 MIT (stabilityai/TripoSR). 상업 이용 가능.
- **입력 계약**: 512×512 RGB. 공식 `run.py`는 rembg로 배경 제거 → 전경 비율 0.85로 리사이즈 → **회색(0.5) 배경 합성**. 우리는 rembg를 끄고 자체 마스크+전처리 결과를 같은 형태로 넣는다.
- **출력**: 기본은 **정점 색 OBJ**(UV 없음). `--bake-texture` 옵션 시 xatlas UV + 텍스처 PNG. marching cubes 해상도 기본 256.
- **VRAM**: 공식 README 기준 기본 설정 약 6 GB. → **권장 12 GB(RTX 3060 12GB/4070급), 최소 8 GB**. OOM 시 mc 해상도 256→192→128로 자동 재시도.
- **속도**: A100에서 0.5초 미만(공식). 소비자 GPU 수 초 예상. CPU 실행은 가능하나 수십 초~분 단위 → 데모용 아님. 실측 필요.
- **환경**: Linux 또는 WSL2 + CUDA 12.x + PyTorch. `torchmcubes`는 설치 PyTorch의 CUDA 버전과 툴킷 일치 필요. → **`docker/gpu-worker.Dockerfile`로 고정**. TripoSR은 커밋 해시 고정해 설치.
- **팀 운영**: GPU 머신 1대(공유) + 나머지는 Mock adapter로 개발. GPU 없으면 Colab/클라우드 스팟으로 평가만 실행.

---

## 3. SAM 2 객체 분할 흐름

- **모델**: SAM 2.1 image predictor (Apache-2.0). 기본 `hiera_small`, 평가에서 `tiny`/`base_plus` 비교. 비디오 기능 사용 안 함.
- **흐름**
  1. 업로드 시 이미지 임베딩 1회 계산 → 프로젝트별 캐시(메모리 LRU + 디스크 `.npy`).
  2. 초기 프롬프트: 입력 검사의 OpenCV 전경 bbox(없으면 중앙 80% 박스). `multimask_output=True` 3개 후보 중 점수 × coverage 조건 최상위 선택.
  3. 사용자 수정: 포함점(+), 제외점(−), 박스, 초기화. 매 수정마다 **모든 누적 프롬프트**로 재예측(임베딩 재사용 → GPU에서 수십 ms).
  4. 후처리: 최대 연결성분 유지 → 작은 구멍 채움(전경의 1% 미만) → open/close → 경계 1~2px feather.
  5. 확정: `mask_v{n}.png` 버전 저장, 수정 횟수·소요 시간 기록(평가 지표).
- **미리보기 4종**: 원본 / 선택 객체(배경 체커보드) / 제거될 배경(반투명 빨강) / 마스크 경계선.
- **그림 특화 위험**: 종이 전체를 객체로 잡음, 선만 잡고 내부가 빔. → 종이 영역 자동 crop, 내부 hole fill, GrabCut 대안을 `SEGMENTER=grabcut`로 유지(GPU 없는 개발·CI·베이스라인 비교용).
- 브라우저 내 SAM(ONNX) 실행은 MVP 제외.

---

## 4. ImageTo3DAdapter 인터페이스 (Python)

```python
class GenerationOptions(BaseModel):
    seed: int = 0
    mc_resolution: int = 256
    bake_texture: bool = False
    texture_resolution: int = 1024
    device: str = "cuda"

class ModelInfo(BaseModel):
    name: str                 # "triposr"
    version: str              # 커밋 해시 / 가중치 리비전
    code_license: str
    weights_license: str
    min_vram_mb: int
    output_format: str        # "obj" | "glb"
    commercial_use: str       # "allowed" | "conditional" | "no"

class EnvironmentStatus(BaseModel):
    ok: bool
    device: str
    gpu_name: str | None
    vram_total_mb: int | None
    problems: list[str]

class GenerationResult(BaseModel):
    job_id: str
    model_name: str
    model_version: str
    options: GenerationOptions
    mesh_path: str
    mesh_format: str
    texture_paths: list[str]
    generation_time_ms: int    # 모델 로드 제외, 추론만
    model_load_time_ms: int
    peak_vram_mb: int | None   # torch.cuda.max_memory_allocated
    log_path: str
    warnings: list[str]

class ImageTo3DAdapter(ABC):
    @abstractmethod
    def get_model_info(self) -> ModelInfo: ...
    @abstractmethod
    def validate_environment(self) -> EnvironmentStatus: ...
    @abstractmethod
    def generate(self, input_rgba: Path, options: GenerationOptions,
                 out_dir: Path, job_id: str) -> GenerationResult: ...
```

- **입력 계약**: 모든 adapter는 우리 전처리기가 만든 **정규화 RGBA PNG**를 받는다. 모델별 변환(회색 합성 등)은 adapter 내부에서. 배경 제거는 adapter가 하지 않는다.
- 구현: `MockAdapter`(CI·프론트 개발용, 픽스처 메시 반환 + 지연/실패 주입), `TripoSRAdapter`, `StableFast3DAdapter`(**`SF3D_ENABLED=true` + 라이선스 동의 플래그** 있을 때만 등록).
- 모델은 워커 프로세스에서 한 번 로드 후 재사용.

---

## 5. 생성 작업 상태 모델

**Project (대화형, 동기 API)**
`UPLOADED → VALIDATED | REJECTED → MASK_PROPOSED → MASK_CONFIRMED`

**GenerationJob (비동기, 워커)**
```
QUEUED → PREPROCESSING → GENERATING → VALIDATING → REPAIRING → EXPORTING → COMPLETED
   └──────────── 어느 단계든 ───────────→ FAILED | CANCELLED
```
- 원안의 `SEGMENTING`은 Project 쪽(`MASK_PROPOSED`)으로 이동(R1).
- `COMPLETED`여도 `is_usable=false`일 수 있음 → 결과는 `outcome: USABLE | USABLE_WITH_WARNINGS | NOT_USABLE` 별도 필드. **생성 성공 ≠ 자산 사용 가능**.
- 테이블: `projects`, `masks`, `jobs`, `job_events`(단계 진입/종료 시각·로그 한 줄), `assets`, `reports`.
- 실패 기록: `{stage, error_code, user_message, retryable, log_path, options}`.
  error_code: `INPUT_INVALID, MODEL_UNAVAILABLE, CUDA_OOM, GENERATION_TIMEOUT, MESH_EMPTY, MESH_UNUSABLE, EXPORT_FAILED, CANCELLED, INTERNAL`.
- 진행 표시: `GET /jobs/{id}/events` **SSE**로 단계 전환 이벤트만 송신. 퍼센트 없음. 단계별 실제 경과 시간 표시.
- 취소: 워커가 단계 경계에서 `cancel_requested` 확인. 재시도: 새 job 생성(이전 job 보존, `retry_of` 연결).

---

## 6. Mesh Quality Inspector 검사 항목 (`mesh-ready-check`)

trimesh(MIT)만 사용. 결과 `schema_version` 포함 JSON.

| 키 | 방법 | 기본 기준 | 등급 |
|---|---|---|---|
| vertex_count / face_count | — | face 0 | ERROR |
| face_budget | face_count ≤ budget | 기본 50k(웹), 초과 시 | WARN (보정 대상) |
| connected_components | `mesh.split(only_watertight=False)` | — | 정보 |
| small_components | 전체 면의 2% 미만 조각 수 | ≥ 1 | WARN |
| largest_component_ratio | 최대 조각 면 비율 | < 0.8 | ERROR (배경 누수 의심) |
| open_boundary_edges | 한 면에만 속한 edge 수 | > 0 | WARN (watertight 필수 아님) |
| non_manifold_edges | 3면 이상 공유 edge 수 | > 면 수의 1% | WARN, > 5% ERROR |
| duplicate_vertices | 위치 병합 전후 차이 | > 0 | WARN |
| degenerate_faces | 면적 ≈ 0 | > 0 | WARN |
| winding_consistent / inverted | `is_winding_consistent`, 부피 부호 | 불일치 | WARN |
| long_edges | edge > median × 20 | > 0 | WARN |
| has_uv / has_texture / has_vertex_colors | visual 검사 | 색 정보 전무 | WARN |
| bbox_size / aspect | 축별 크기 | 최소축/최대축 < 0.02 (종잇장) | WARN → COLLAPSED_BACK 후보 |
| centered | bbox 중심 xz ≈ 0 | 아님 | WARN (보정 대상) |
| grounded / below_floor | min y ≈ 0 / < 0 | 아님 | WARN (보정 대상) |
| finite | NaN/Inf 정점 | 존재 | ERROR |

`is_usable = ERROR 없음`. CLI: `mesh-ready-check model.glb --budget 50000 --fail-on error --json report.json` (exit code로 CI 실패).

---

## 7. 자동 보정 가능 / 불가능

**자동 보정 (MVP, trimesh)**
중복 정점 병합 · 퇴화/중복 면 제거 · 작은 분리 조각 제거 · 노멀·winding 재계산 · 작은 구멍 채움(`fill_holes`, 소형만) · 원점 중앙 정렬 · 높이 1.0m 정규화 · 바닥(y=0) 정렬 · 폴리곤 감소(quadric, `fast-simplification` MIT) · 정점색/텍스처 포함 GLB 내장 · 텍스처 경로 정리

**규칙**: 단계마다 전후 지표 기록. 지표가 나빠지면(예: 조각 제거로 면 50% 이상 손실) 그 단계 롤백. `raw.obj`, `repaired.glb` 모두 보존.

**자동 보정 불가 → 재생성·사용자 조치 안내**
| 문제 | 안내 |
|---|---|
| COLLAPSED_BACK (뒷면 납작/붕괴) | 단일 이미지 한계. 다른 seed / 다른 모델로 재생성 |
| MISSING_PART | 마스크 수정 후 재생성 |
| BACKGROUND_LEAK (본체와 붙은 배경) | 마스크 수정. 분리된 경우만 자동 제거 |
| BROKEN_TEXTURE | 텍스처 베이크 on/off 재생성 |
| 큰 구멍·심한 non-manifold | 정적 관찰용으로만 사용, 물리는 bbox 충돌체 |
| 리깅 | MVP 제외 |

---

## 8. 인터랙티브 월드 최소 조작 범위

- **씬**: 10×10m 바닥 + 낮은 벽 4면, 조명 1+환경광, 밀 수 있는 상자·공 2~3개.
- **스택**: React Three Fiber + drei + `@react-three/rapier`.
- **오브젝트**: 생성 자산 = dynamic rigid body 1개. 충돌체 기본 `convex_hull`(서버에서 계산한 hull 정점, ≤ 64점으로 단순화해 `asset.json`에 포함), 실패 시 `bounding_box`로 자동 폴백.
- **조작 (MVP 확정)**: WASD 이동 · Q/E 회전 · Space 점프(접지 시) · 밀기(물리로 자동) · R 리셋 · 마우스 orbit 카메라. → 원안 "최소 2개"를 넘어 4개.
- 크기 변경 슬라이더는 여유 시.

---

## 9. 첫 번째 평가 이미지 데이터

총 **60장 v1**:

| 그룹 | 수 | 내용 |
|---|---|---|
| A. 그림(정상) | 30 | 동물 8 · 탈것 6 · 사람/캐릭터 6 · 사물 6 · 식물/건물 4. 색칠된 그림, 흰 종이 |
| B. 사진 | 15 | 팀이 직접 촬영한 단일 사물(장난감, 컵 등) |
| C. 하드 케이스 | 15 | 작은 객체 · 잘림 · 배경 유사색 · 여러 객체 · 흐림 · 연필 스케치(무채색) · 그림자 각 2~3장 |

- 출처: 팀원과 동의한 가족이 직접 그린 것만. **보호자 동의서** 보관. 인터넷 이미지 금지.
- 각 이미지: `id, group, category, difficulty, source, consent, sha256, notes`. GT 마스크는 우리 마스크 편집기로 제작 → `evals/segmentation-labels/`(비공개).
- 저장소에는 `evals/manifest.csv`만. 공개 샘플 5장(CC0, 팀 제작)은 `assets/samples/`에 커밋 → 데모·CI.

---

## 10. 모델 비교 실험 방법

- **고정**: 같은 평가셋, 같은 전처리 출력, seed 3개(0,1,2), 같은 하드웨어(기록), 모델 로드 시간 분리, warm-up 1회 후 측정.
- **지표**
  - 시간(중앙값), peak VRAM
  - 생성 성공률(메시 비어있지 않음) vs **사용 가능률**(inspector `is_usable`) — 핵심 KPI
  - components, non-manifold, 면 수
  - **실루엣 IoU**: 메시를 정면 정사영 → OpenCV fillPoly로 실루엣 → 입력 마스크와 IoU (GL 불필요, CI에서도 동작)
  - 선택: CLIP 유사도(입력 vs 정면 렌더)
  - 월드 로딩 성공률(GLB 파싱 + hull 생성 성공)
  - 사용자 선호: 팀 외부 10명 이상, 블라인드 2지선다
- **실험 축 (한 번에 하나)**: 분할 4종(없음/GrabCut/SAM2/SAM2+수정) · 모델 2종 · 전처리 6축(전경 비율 0.65/0.75/0.85/0.95, 배경 회색/흰색/검정, 밝기 정규화 on/off, 여백, 해상도 256/512/1024).
- 산출: `evals/generation-results/<run_id>/{config.json, per_image.csv, summary.json}` → `docs/experiments.md`에 표로 기록.

---

## 11. 프론트엔드 / 백엔드 책임

| 영역 | 프론트엔드 | 백엔드 |
|---|---|---|
| 업로드 | 파일 선택, 클라이언트 측 크기·형식 사전 체크, 경고 표시 | 최종 검증, EXIF 제거, 저장 |
| 분할 | 점·박스 입력 UI, 마스크 오버레이 렌더 | SAM2/GrabCut 예측, 후처리, 마스크 버전 저장 |
| 생성 | SSE 구독, 단계·경과시간·로그 표시, 취소/재시도 버튼 | job 큐, 워커, 단계 기록, 실패 분류 |
| 3D 결과 | GLB 로딩, 와이어프레임·텍스처 토글, 원본/보정 비교 | 검사·보정·GLB 변환, 보고서 JSON |
| 월드 | 물리·조작·카메라 (Rapier) | 충돌체 데이터(hull 정점) + `asset.json` 생성 |
| 보고서 | 표시·다운로드 | 보고서 JSON 생성, 파일 서빙 |

원칙: **판정은 서버, 표시는 클라이언트**. 프론트는 품질을 재계산하지 않는다. API 스키마는 FastAPI OpenAPI → `openapi-typescript`로 TS 타입 자동 생성.

---

## 12. 7인 역할 분담

| # | 역할 | 소유 모듈 | 1차 산출물 |
|---|---|---|---|
| 1 | 리드 / 아키텍트 | 전체 구조, docs, decision-log, licenses, 일정 | 인터페이스 확정, 주간 데모 |
| 2 | 백엔드 | FastAPI, DB, job·워커, SSE, CI | API + 상태머신 + CI |
| 3 | AI-분할·전처리 | 입력 검사, SAM2, GrabCut, 전처리기 | 마스크 API, 분할 실험 |
| 4 | AI-생성 | adapter, GPU 워커 Docker, TripoSR/SF3D, 성능 측정 | 생성 adapter, 모델 비교 실험 |
| 5 | 3D 메시 | mesh-ready-check, 보정, GLB, 충돌체 | OSS 패키지, 메시 실험 |
| 6 | 프론트 앱 | 업로드·마스크 편집·진행·보고서 화면, API 클라이언트 | 화면 1·2·3·6 |
| 7 | 프론트 3D | 뷰어, 월드, Rapier, 조작 | 화면 4·5 |

평가셋 구축은 3·4·5가 분담, 1이 manifest·동의서 관리. 각 모듈은 Mock 경계가 있어 GPU 없이 병렬 개발 가능.

---

## 13. 가장 큰 위험

### 기술
1. **[최대] 아동 그림 ↔ TripoSR 도메인 갭.** 학습 데이터는 3D 렌더 중심. 평면 그림은 얇은 판·뒷면 붕괴가 흔할 것. → **3단계 첫날 그림 10장으로 스파이크**, 전처리(윤곽 두께·채색) 실험, SF3D 비교, 화면 고지문. 사용 가능률 목표는 실측 후 설정.
2. SAM2가 그림에서 종이 전체 또는 선만 선택. → 종이 crop, hole fill, 사용자 수정, GrabCut 베이스라인.
3. GPU 환경 구축(`torchmcubes` 빌드, CUDA 버전) 지연. → Docker 고정, Mock으로 나머지 팀 블로킹 제거.
4. GPU 자원 부족(공유 1대). → 큐 동시성 1, 평가 배치는 야간 실행.
5. 오목한 객체의 convex hull 부정확 / 고폴리 GLB 브라우저 성능. → 50k 예산 감소, MVP는 hull 허용.

### 라이선스·개인정보
| 대상 | 라이선스 | 주의 |
|---|---|---|
| TripoSR | MIT | 문제 적음 |
| SAM 2 | Apache-2.0 | NOTICE 유지 |
| Stable Fast 3D | Stability AI Community License | 연 매출 한도 등 조건부 상업 이용. **원문 확인 후** 실험 전용·플래그로 격리. 데모 배포 기본값 OFF |
| PyMeshLab | **GPL-3.0** | mesh-ready-check(MIT)에 import 금지. 외부 프로세스·선택 기능만 |
| Blender | GPL | headless 외부 프로세스 호출만. 출력물은 무관 |
| rembg / U²-Net | (TripoSR 기본 경로) | 우리 파이프라인에서 사용 안 함 |
| Three.js / Rapier / trimesh / fast-simplification | MIT / Apache-2.0 / MIT / MIT | — |

- **아동 이미지**: 보호자 동의, EXIF 제거, 서버 보관 기본 24시간 후 자동 삭제(`RETENTION_HOURS`), 업로드 화면 고지, 공개 저장소 커밋 금지(.gitignore + CI 검사).
- 모든 라이선스 판단은 `docs/licenses.md`에 출처 링크와 확인 날짜로 기록. 법률 자문 대체 아님.
