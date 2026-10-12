# Draw2World AI — 설계 및 구현 계획

이 문서가 **작업 진행 상황의 단일 기준**이다. 상세 근거는 `docs/proposal.md`, 결정 기록은 `docs/decision-log.md`.

---

## 0. 작업 규칙 (필수)

모든 작업은 아래 순서를 지킨다.

1. 작업 시작 전: 이 문서의 해당 작업 상태를 `🟡 진행중`으로 바꾼다.
2. 커밋·푸시: `docs(plan): <ID> 진행중`
3. 구현한다.
4. 해당 작업의 **스모크 테스트**와 관련 단위 테스트를 실제로 실행한다.
5. 통과하면 상태를 `✅ 완료`로 바꾸고 작업 로그(§6)에 결과 한 줄을 추가한다.
6. 커밋·푸시: `feat(<scope>): <ID> <요약>` (코드 + 문서 상태 변경 함께)
7. 실패하면 `🟡 진행중` 유지, 작업 로그에 실패 내용 기록, 고칠 때까지 완료 처리 금지. 해결 불가 시 `❌ 보류`와 사유 기록.

상태 표기: `⬜ 대기` · `🟡 진행중` · `✅ 완료` · `❌ 보류`

---

## 1. 전체 아키텍처

```
┌──────────────── Browser (frontend/) ────────────────┐
│ 업로드 → 마스크 편집 → 진행(SSE) → 3D 뷰어 → 월드 → 보고서 │
│ React + TS + Vite · R3F · @react-three/rapier · Zustand │
└───────────────┬────────────────────▲────────────────┘
                │ REST (JSON, multipart)│ SSE (단계 이벤트)
┌───────────────▼────────────────────┴────────────────┐
│ API 서버 (backend/app, FastAPI, Python 3.12)          │
│  input · segmentation · api · jobs(enqueue) · files   │
└───────────────┬─────────────────────────────────────┘
                │ SQLite (projects, masks, jobs, job_events, assets)
┌───────────────▼─────────────────────────────────────┐
│ 워커 (python -m app.worker, 동시성 1)                 │
│  preprocess → generation(adapter) → mesh inspect      │
│  → repair → export(GLB, collider, asset.json) → report│
└───────────────┬─────────────────────────────────────┘
                │ 파일
        data/ (gitignore) : 업로드·마스크·중간 이미지·메시·보고서
```

- **대화형 단계**(업로드·검사·분할·마스크 확정)는 API 서버가 동기 처리.
- **무거운 단계**(전처리~보고서)는 워커가 job 단위로 처리.
- 모델 호출은 `ImageTo3DAdapter` 경유. 개발·CI는 `MockAdapter`, GPU 머신은 `TripoSRAdapter`.
- 분할은 `Segmenter` 경유. 기본 `GrabCutSegmenter`, GPU 머신은 `Sam2Segmenter`.

### 상태 모델

```
Project : UPLOADED → VALIDATED | REJECTED → MASK_PROPOSED → MASK_CONFIRMED
Job     : QUEUED → PREPROCESSING → GENERATING → VALIDATING → REPAIRING → EXPORTING → COMPLETED
          (어느 단계든) → FAILED | CANCELLED
Job.outcome (COMPLETED일 때): USABLE | USABLE_WITH_WARNINGS | NOT_USABLE
```

---

## 2. 디렉토리 구조 (목표)

```
draw2world-ai/
├─ IMPLEMENTATION_PLAN.md        ← 이 문서 (진행 상태)
├─ CLAUDE.md
├─ README.md · LICENSE(MIT) · .gitignore · .env.example
├─ .github/workflows/ci.yml
├─ docs/
│  ├─ project-brief.md · proposal.md · build-plan.md · decision-log.md
│  ├─ architecture.md · model-selection.md · mesh-quality.md
│  ├─ experiments.md · licenses.md
├─ packages/
│  └─ mesh-ready-check/          ← 독립 OSS 패키지 (trimesh만 의존, MIT)
│     ├─ pyproject.toml
│     ├─ src/mesh_ready_check/{__init__,inspect,report,cli,thresholds}.py
│     └─ tests/
├─ backend/
│  ├─ pyproject.toml
│  ├─ app/
│  │  ├─ main.py                 ← FastAPI 앱 생성
│  │  ├─ worker.py               ← 워커 진입점
│  │  ├─ core/                   ← 설정(pydantic-settings), 로깅, 경로, 에러 코드
│  │  ├─ db/                     ← SQLAlchemy 모델, 세션
│  │  ├─ api/                    ← 라우터: projects, jobs, assets, health, files
│  │  ├─ input/                  ← 입력 이미지 검사
│  │  ├─ segmentation/           ← Segmenter 인터페이스, grabcut, sam2, 후처리
│  │  ├─ preprocess/             ← 정규화 RGBA 생성
│  │  ├─ generation/             ← ImageTo3DAdapter, mock, triposr, sf3d, registry
│  │  ├─ mesh/                   ← inspect(=mesh-ready-check 호출), repair
│  │  ├─ export/                 ← GLB, collider, asset.json
│  │  ├─ report/                 ← 보고서, 실패 유형 분류
│  │  └─ jobs/                   ← 상태머신, 큐 claim, 단계 실행기, 이벤트
│  └─ tests/{unit,integration,gpu}/
├─ frontend/
│  ├─ package.json · vite.config.ts · tsconfig.json
│  ├─ src/
│  │  ├─ app/                    ← 라우팅, 레이아웃
│  │  ├─ features/{upload,segmentation,generation,model-viewer,world,quality-report}/
│  │  ├─ three/                  ← 공통 R3F 컴포넌트, GLB 로더, 충돌체 변환
│  │  ├─ services/               ← API 클라이언트, SSE
│  │  ├─ stores/                 ← Zustand
│  │  └─ types/api.ts            ← openapi-typescript 생성물
│  └─ tests/
├─ docker/gpu-worker.Dockerfile
├─ evals/
│  ├─ manifest.csv · configs/ · benchmark.py · compare.py · metrics/
│  └─ generation-results/        ← gitignore
├─ assets/
│  ├─ samples/                   ← 팀 제작 공개 샘플(CC0)
│  └─ demo-world/
├─ scripts/                      ← dev 실행, 샘플 생성, 스모크 테스트
└─ data/                         ← 런타임 저장소 (gitignore)
```

### 런타임 파일 레이아웃 (`data/`)

```
data/projects/{project_id}/
  original.png            ← EXIF 제거·축소 후
  validation.json
  masks/mask_v{n}.png · prompts_v{n}.json
  jobs/{job_id}/
    preprocess/{01_cutout,02_centered,03_normalized}.png
    generation/raw.obj · generation_result.json · model.log
    mesh/inspect_raw.json · repaired.glb · inspect_repaired.json · repair_steps.json
    export/asset.json · collider.json
    report.json
```

---

## 3. 모듈 설계 요약

| 모듈 | 공개 인터페이스 | 입력 → 출력 |
|---|---|---|
| input | `validate_image(path) -> ValidationResult` | 업로드 파일 → 검사 결과 JSON |
| segmentation | `Segmenter.propose(img) / refine(img, prompts) -> Mask` | 이미지+프롬프트 → 이진 마스크 |
| preprocess | `normalize(img, mask, opts) -> PreprocessResult` | 원본+마스크 → 정규화 RGBA + 단계별 이미지 |
| generation | `ImageTo3DAdapter.generate(rgba, opts, out_dir, job_id)` | RGBA → 메시 + 측정값 |
| mesh-ready-check | `inspect(mesh, thresholds) -> Report` | 메시 → 품질 JSON |
| mesh.repair | `repair(mesh) -> (mesh, steps)` | 메시 → 보정 메시 + 단계별 전후 지표 |
| export | `to_glb`, `build_collider`, `build_asset` | 보정 메시 → GLB, hull 정점, asset.json |
| report | `build_report(job) -> Report` | 전 단계 산출물 → 보고서 + 실패 유형 |
| jobs | `enqueue`, `claim_next`, `run_job`, `cancel` | DB 상태 전이 + 이벤트 기록 |

### API

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/projects` | 업로드 + 입력 검사 |
| GET | `/api/projects/{id}` | 프로젝트 상태·검사 결과 |
| POST | `/api/projects/{id}/segment` | 프롬프트(점·박스)로 마스크 예측 |
| POST | `/api/projects/{id}/mask/confirm` | 마스크 확정 |
| POST | `/api/projects/{id}/jobs` | 생성 job 생성 (adapter, options) |
| GET | `/api/jobs/{id}` | job 상태·결과·실패 정보 |
| GET | `/api/jobs/{id}/events` | SSE 단계 이벤트 |
| POST | `/api/jobs/{id}/cancel` · `/retry` | 취소 · 재시도(새 job) |
| GET | `/api/assets/{id}` | asset.json |
| GET | `/api/files/{path}` | 산출물 파일 서빙 (data/ 하위만) |
| GET | `/api/health` · `/api/health/models` | 서버 · adapter 환경 상태 |

### 설정 (`.env`)

`DATA_DIR`, `DATABASE_URL`, `MAX_UPLOAD_MB=10`, `RETENTION_HOURS=24`, `SEGMENTER=grabcut|sam2`, `GENERATOR=mock|triposr|sf3d`, `SF3D_ENABLED=false`, `SF3D_LICENSE_ACCEPTED=false`, `FACE_BUDGET=50000`, `MOCK_FAIL=`(테스트용 실패 주입)

### 테스트 전략

- 단위: 모듈별 pytest / vitest. 메시·이미지 픽스처는 코드로 생성.
- 통합: Mock 모드로 API→워커→산출물 전체.
- 스모크: 각 작업마다 아래 표의 명령. 서버를 실제로 띄워 확인하는 것을 원칙으로 함.
- GPU: `@pytest.mark.gpu`, CI 제외.

---

## 4. 단계별 구현 계획

### 1단계 — 뼈대 + 백엔드 코어 + mesh-ready-check (GPU 불필요)

| ID | 작업 | 산출물 | 스모크 테스트 | 상태 |
|---|---|---|---|---|
| 1-1 | 저장소 기본 설정 | `.gitignore`, `.env.example`, `README.md`, `LICENSE`, `docs/*.md` 초안, CI 골격 | `git check-ignore data/x.png .env` 둘 다 무시됨 | ✅ 완료 |
| 1-2 | mesh-ready-check 패키지 | inspect·CLI·임계값·테스트 픽스처 | `pytest packages/mesh-ready-check` 통과 + 박스 메시에 CLI 실행 시 exit 0, 떠있는 조각 메시 `--fail-on warn` exit 1 | ✅ 완료 |
| 1-3 | 백엔드 골격 | FastAPI 앱, 설정, DB 모델, 세션, `/api/health` | uvicorn 기동 → `GET /api/health` 200 | ✅ 완료 |
| 1-4 | 입력 검사 + 업로드 API | `input/`, `POST/GET /api/projects`, 샘플 이미지 생성 스크립트 | 샘플 PNG 업로드 → `VALIDATED`, 4px 이미지 → `REJECTED` | ✅ 완료 |
| 1-5 | 분할 (GrabCut) + 마스크 API | `segmentation/`, segment·confirm API | 샘플 업로드 → segment → 마스크 PNG coverage 0.05~0.9 → confirm 시 `MASK_CONFIRMED` | ✅ 완료 |
| 1-6 | 전처리 | `preprocess/` 단계별 이미지 저장 | 정규화 결과 512×512 RGBA, 전경 bbox 중심 ±2%, 전경 비율 0.85±0.05 | ✅ 완료 |
| 1-7 | Adapter + MockAdapter | 인터페이스, mock(픽스처 메시·지연·실패 주입), registry, `/api/health/models` | `/api/health/models`에 mock ok, mock generate → OBJ 생성 | ✅ 완료 |
| 1-8 | Job 상태머신 + 워커 + SSE | `jobs/`, `worker.py`, job API, SSE | job 생성 → 워커 1회 실행 → SSE로 단계 이벤트 순서대로 수신 → `COMPLETED`; `MOCK_FAIL=oom` → `FAILED/CUDA_OOM/retryable` | ✅ 완료 |
| 1-9 | 보정 + GLB + 충돌체 | `mesh/repair`, `export/` | 떠있는 조각 포함 mock 메시 → 보정 후 components 1, grounded·centered true, GLB 로드 가능, hull ≤ 64점 | ✅ 완료 |
| 1-10 | 보고서 + 통합 테스트 + CI | `report/`, 통합 테스트, `ci.yml` 완성, `scripts/smoke_stage1` | `scripts/smoke_stage1` 전체 흐름 통과, `ruff check` + `pytest` 전체 통과 | ✅ 완료 |

### 2단계 — 프론트엔드 6개 화면 (Mock 백엔드로 E2E)

| ID | 작업 | 산출물 | 스모크 테스트 | 상태 |
|---|---|---|---|---|
| 2-1 | 프론트 골격 | Vite+React+TS, 라우팅, API 타입 생성, proxy, dev 스크립트 | `npm run typecheck && npm run build` 통과, dev 서버에서 `/api/health` 프록시 응답 | ✅ 완료 |
| 2-2 | 화면 1 업로드 | 드래그앤드롭, 조건·가이드·샘플·개인정보 안내, 경고 표시 | 샘플 업로드 → 검사 결과·경고 렌더 (vitest + 수동) | ✅ 완료 |
| 2-3 | 화면 2 마스크 편집 | 4종 미리보기, 포함/제외 점, 박스, 초기화, 확정 | 점 추가 → segment 호출 → 오버레이 갱신 → 확정 | ✅ 완료 |
| 2-4 | 화면 3 생성 진행 | SSE 타임라인, 경과 시간, 로그, 취소·재시도, 실패 메시지 | mock job 단계가 실제 순서대로 표시, 실패 주입 시 메시지·재시도 동작 | ✅ 완료 |
| 2-5 | 화면 4 3D 뷰어 | GLB 로딩, orbit, 와이어프레임, 색 토글, 원본/보정 비교, 지표 표, 고지문 | mock GLB 로드·토글 동작, 콘솔 에러 없음 | ✅ 완료 |
| 2-6 | 화면 5 월드 | 방, Rapier, WASD·Q/E·Space·R, 상자·공, hull→bbox 폴백 | 자산 스폰 → 이동·회전·점프·밀기 확인, hull 데이터 없으면 bbox로 로드 | ✅ 완료 |
| 2-7 | 화면 6 보고서 + CI | 보고서·다운로드, CI에 프론트 잡 추가, README 실행법 | 전체 흐름 수동 E2E, `typecheck/build/test` + 백엔드 테스트 통과 | ✅ 완료 |

### 3단계 — 실제 AI 연결 (SAM 2 + TripoSR)

| ID | 작업 | 산출물 | 스모크 테스트 | 상태 |
|---|---|---|---|---|
| 3-1 | GPU 워커 환경 | `docker/gpu-worker.Dockerfile`, WSL2 설치 문서, 가중치 캐시 볼륨 | 컨테이너에서 `torch.cuda.is_available()` true, TripoSR·SAM2 import 성공 | ✅ 완료 |
| 3-2 | Sam2Segmenter | 임베딩 캐시, 누적 프롬프트, multimask 선택, 종이 crop·hole fill | 샘플 3장 segment 성공, 재예측 지연 측정 기록 | ✅ 완료 |
| 3-3 | TripoSRAdapter | 회색 합성 512, mc 해상도, 텍스처 베이크, 시간·VRAM 측정, OOM 재시도 | `pytest -m gpu` 통과, 샘플 → `raw.obj` 생성·측정값 기록 | ✅ 완료 |
| 3-4 | StableFast3DAdapter | 플래그·라이선스 동의 시에만 등록 | 플래그 OFF면 미등록, ON이면 샘플 1장 생성 | ⬜ 대기 |
| 3-5 | 보정 강화 + 모델 상태 | quadric 감소, 텍스처 GLB 내장, `/health/models` 실측 | 100k 면 메시 → 50k 이하, GLB 텍스처 포함 확인 | ✅ 완료 |
| 3-6 | 그림 10장 스파이크 | 스파이크 스크립트, `docs/experiments.md` 기록 | 10장 실행 완료, 성공/사용가능/시간/VRAM 표 기록 | ✅ 완료 |

### 4단계 — 평가·실패 분류·개선 비교

| ID | 작업 | 산출물 | 스모크 테스트 | 상태 |
|---|---|---|---|---|
| 4-1 | 평가셋 manifest | `evals/manifest.csv` 스키마·검증 스크립트 | 공개 샘플 manifest 검증 통과, 잘못된 행 검출 | ✅ 완료 |
| 4-2 | benchmark + 지표 | `benchmark.py`, 마스크 IoU·실루엣 IoU·사용 가능률 등 | `benchmark.py --config evals/configs/smoke.yaml`(mock) → `summary.json` 생성 | ✅ 완료 |
| 4-3 | 실패 유형 분류기 | 규칙 기반 분류, 보고서 연동 | 유형별 픽스처 메시가 기대 코드로 분류 | ✅ 완료 |
| 4-4 | 비교 + 보고서 UI + CI | `compare.py`, 화면 6 실패 유형·해결 안내, CI 스모크 | 두 run 비교표 생성 → `docs/experiments.md` 반영, CI 통과 | ✅ 완료 |

### 5단계 — 6방향 뷰 + 자연어 전체 변환 편집 (설계: `docs/designs/view-and-edit.md`)

| ID | 작업 | 산출물 | 스모크 테스트 | 상태 |
|---|---|---|---|---|
| 5-1 | 편집 코어 | `backend/app/edit/` op 스키마·패널 기준표·라벨 회전·합성(4×4)·stand_up·invert_last·누적 범위 검사·no-op 판정, 공용 기준표 JSON | 6패널×op 매트릭스, mirror 면 감김·부피 부호, 텍스처 UV 유지, stand_up(원뿔·막대), 범위 밖 거절 테스트 통과 | ✅ 완료 |
| 5-2 | 버전 모델 + API | 업로드 view_label, e0 생성, 편집 버전(append-only·prev_state), 워커 적용(QC target_size=None·충돌체·GLB), edits/undo/revert API, active_version·SSE | mock 흐름: e1→e2→undo→undo = e0 op, 실패 주입 → failed·active 유지, pending 중 undo 409 | ⬜ 대기 |
| 5-3 | EditPlanner | 인터페이스(ops/refuse/clarify), MockPlanner(한국어 규칙), LLM adapter(플래그) | 공용 계약 테스트: "세워줘"·"두껍게"·"반대로"·"귀 길게"(refuse)·"45도"(refuse) | ⬜ 대기 |
| 5-4 | 프론트 6패널 편집 | 고정 범위 ortho 6패널·e0 외곽선, 패널 선택+채팅, 버전 타임라인·undo | vitest + E2E 1개(세워줘→두껍게→undo) | ⬜ 대기 |
| 5-5 | pages 데모 적용 | 공용 기준표 JSON 사용, JS 편집 코어·Mock 규칙 | 기준표 JSON 교차 언어 테스트 + 브라우저 수동 확인 | ⬜ 대기 |

---

## 5. 완료 정의 (프로젝트 전체)

`docs/project-brief.md` §24의 14개 시나리오가 GPU 머신에서 실제로 동작하고, 4-4 비교표에 개선 전후 수치가 기록되면 MVP 완료.

---

## 6. 작업 로그

| 날짜 | ID | 결과 | 비고 |
|---|---|---|---|
| 2026-10-11 | 0-0 | ✅ 완료 | 설계 문서·제안서·구현 계획 작성 |
| 2026-10-11 | 1-1 | ✅ 완료 | ignore 규칙 6종 확인, 금지 파일 검사 정상/위반 케이스 모두 기대대로, CI YAML 파싱·`contents: read` 확인. 로컬 Python 없음 → uv로 3.12 사용 |
| 2026-10-11 | 1-2 | ✅ 완료 | pytest 42개 통과, ruff check/format 통과. CLI 스모크: clean_box exit 0, floating_piece `--fail-on warn` exit 1, two_halves exit 1 + JSON 보고서 생성. Windows 스마트 앱 컨트롤이 numpy DLL 차단 → WSL에서 실행(D-013) |
| 2026-10-11 | 1-3 | ✅ 완료 | pytest 5개·ruff 통과. uvicorn 기동 → /api/health 200, 경로 탈출 404, SQLite WAL 생성 확인 |
| 2026-10-11 | 1-4 | ✅ 완료 | pytest 22개 통과. 서버 스모크: 샘플 3장 업로드 → VALIDATED(coverage 0.11~0.16, 객체 1개, 경고 없음), 4px → 422 REJECTED(저장 안 함) |
| 2026-10-11 | 1-5 | ✅ 완료 | pytest 36개 통과. 서버 스모크: 샘플 3장 업로드 시 마스크 v1 자동 제안(0.4~0.65초) → segment v2 coverage 0.13~0.15 → confirm MASK_CONFIRMED. 자동차 마스크 육안 확인. 윤곽선만 있는 그림 내부 미채움 버그 → D-015로 수정 |
| 2026-10-11 | 1-6 | ✅ 완료 | pytest 42개 통과. 샘플 3장: 512×512 RGBA, 전경 중심 (255.5, 255.5), 전경 비율 0.842(목표 0.85±0.05), 단계별 이미지 3장+preprocess.json 저장, 별 결과 육안 확인. 깨끗한 그림에 밝기 보정이 걸리는 문제 → D-016 |
| 2026-10-11 | 1-7 | ✅ 완료 | pytest 50개 통과. /api/health/models: mock ok, triposr 미구현(3-3), sf3d 플래그 OFF로 비활성. 샘플 3장 mock 생성 → raw.obj 11k~23k 면, 의도한 결함(중앙·바닥·작은 조각) 검출 |
| 2026-10-11 | 1-8 | ✅ 완료 | pytest 62개 통과. 실제 API+워커 프로세스 스모크: SSE로 QUEUED→5단계 enter/exit(실측 ms)→COMPLETED→end 순서 수신. MOCK_FAIL=oom → GENERATING에서 FAILED, CUDA_OOM, retryable=true. 스모크 중 이전 워커가 남아 있던 스크립트 문제 발견·수정 |
| 2026-10-11 | 1-9 | ✅ 완료 | pytest 71개 통과. 샘플 3장 실제 워커 실행: 원본 조각 2·중앙/바닥 X → 보정 GLB 조각 1, centered·grounded, 최대 축 1.0, 정점 색 유지, convex hull 10/51/64점, 롤백 없음. 납작 형상 충돌체 판정 버그 수정(두께 하한 있는 상자) |
| 2026-10-11 | 1-10 | ✅ 완료 | pytest 77개·ruff 통과. scripts/smoke_stage1.sh: 서버 기동 → job 완료(USABLE) → 산출물 10종 다운로드 → 보고서 스키마 → asset → SSE end → 실패 주입(CUDA_OOM) 모두 통과. CI에 backend 잡(ruff·pytest·스모크) 추가 |
| 2026-10-11 | 2-1 | ✅ 완료 | typecheck·build·vitest 12개 통과. Vite(5391) → WSL 백엔드(8077) 프록시 /api/health 응답 확인, SPA 라우트 200. 포트 충돌(5173·5180·8000 다른 앱 점유) 발견 → D-017 |
| 2026-10-11 | 2-2 | ✅ 완료 | vitest 16개 통과. Playwright(Edge) E2E 2개: 샘플 사과 업로드 → 검사 통과·객체 1개 → 객체 선택 이동, 1×1 PNG → 거부 사유 표시. 화면 스크린샷 확인 |
| 2026-10-11 | 2-3 | ✅ 완료 | vitest 21개 통과. E2E(Edge): 자동차 업로드 → 미리보기 4종 표시 → 포함점 v2 → 사각형 드래그 v3 → 초기화 v4 → 확정·생성 시작 /jobs/{id} 이동. 스크린샷 확인 |
| 2026-10-11 | 2-4 | ✅ 완료 | vitest 26개·백엔드 pytest 79개 통과. E2E(Edge): 생성 단계 running 표시·실측 경과 시간 → 5단계 done → 완료 판정, 대기 중 작업 취소 → 취소 카드·재시도 버튼. E2E가 잡은 버그 2건 수정: SQLite 시각 UTC 누락으로 경과 9시간 표시, 대기 중 취소 시 error 정보 없음 |
| 2026-10-11 | 2-5 | ✅ 완료 | vitest 29개·pytest 80개·mesh-ready-check 43개 통과. E2E(Edge): 완료 작업 → 원본·보정본 뷰어 2개(WebGL) → 품질 표(바닥·조각 전후) → 와이어프레임 토글 → 비교 끄기, 페이지 오류 없음. 화면에서 색이 어둡게 보이는 문제 발견 → GLB 머티리얼·노멀·linear 색 보정(D-019) |
| 2026-10-11 | 2-6 | ✅ 완료 | vitest 37개 통과. E2E(Edge, 실제 Rapier 물리): 자동차 자산 스폰 → 바닥 착지 → W 0.7초 이동 0.5m 이상 → Q 회전 0.3rad 이상 → Space 점프 y>0.15 → R 원위치 → 충돌체 디버그 표시(convex hull 42점). 스크린샷 확인 |
| 2026-10-11 | 2-7 | ✅ 완료 | typecheck·vitest 37개·build 통과. Playwright E2E 전체 8개 통과(업로드 2, 마스크, 진행 2, 결과, 월드, 보고서) — 마스크 미리보기 alt 중복으로 1건 실패 → 수정 후 재실행 통과. 보고서 다운로드 5종 200·GLB 매직 확인. 도중 WSL ext4가 I/O 오류로 읽기 전용 전환 → wsl --shutdown으로 복구(데이터 유지) |
| 2026-10-11 | 3-1 | 🟡 진행중 (실패) | 점검 스크립트 `scripts/check_gpu_env.py`·`pytest -m gpu` 테스트·.dockerignore 추가, Dockerfile uv 설치 수정. WSL venv에 torch 없었음(이전 설치 중단) → 재설치 중 uv 캐시 휠 손상·Bus error·ext4 읽기 전용 반복. 원인: Windows C: 여유 0바이트. Docker 빌드도 같은 이유로 중단. C: 공간 확보 후 재시도 필요 |
| 2026-10-11 | 3-1 | ✅ 완료 | C: 공간 확보 후 재시도. WSL venv 재생성 → `check_gpu_env.py` 4항목 통과(torch 2.5.1+cu124 cuda True, RTX 4060, SAM 2·TripoSR import, marching cubes 대체), `pytest -m gpu` 2개·전체 80개 통과. Docker: base 이미지를 cuda base로 축소, uv 0.13.0, SAM 2 빌드 격리 끔(torch 중복 다운로드 2.5GB 제거) → 빌드 성공 10.2GB, `docker run --gpus all` 점검 4항목 통과. 도중 C: 0바이트로 Docker 엔진 다운 1회 |
| 2026-10-11 | 3-2 | ✅ 완료 | 새 개발 PC(RTX 4050 6GB)에서 `setup-gpu-env.sh`로 WSL venv 재구성 → `check_gpu_env.py` 4항목 통과. pytest 92개·`pytest -m gpu` 6개(샘플 3장 분할·메모리/디스크 캐시)·ruff 통과. `scripts/smoke_sam2.sh`(SEGMENTER=sam2 서버): 샘플 3장 v1 자동 제안 coverage 0.13~0.15, 첫 임베딩 포함 0.5~1.4초 → 누적 재예측(점1·점2·점2+박스) 66~115ms(디코더 40~60ms). 처음엔 재예측 150~560ms — 전경 추정을 원본 해상도로 매번 계산한 탓 → 512 축소본 계산·같은 이미지 특징 재업로드 생략으로 수정 (D-021) |
| 2026-10-11 | 3-3 | ✅ 완료 | pytest 100개·`pytest -m gpu` 7개·mesh-ready-check 43개·ruff 통과. `scripts/smoke_triposr.sh`(SAM 2 + TripoSR 서버·워커): 샘플 3장 COMPLETED, raw 52.9k~90.3k 면 → 보정 50k, 생성 5.8~7.3초(mc 256), 모델 로드 7초(ext4 캐시, /mnt/c면 68초), 최대 VRAM 2379MiB(RTX 4050 6GB). 텍스처 베이크 job: 1024 텍스처 생성, 39초(llvmpipe 래스터). 정면 실루엣 IoU 0.93~0.97(좌우 반전 0.80)로 좌표 변환 확인. 발견·수정: TripoSR 베이크가 CPU 텐서로 GPU 모델 질의(원본 버그), chunk 8192→65536(추출 20→11초, VRAM 동일), Docker 가중치가 볼륨 밖에 저장되던 문제. 측정 중 노트북 GPU가 SW 전력 제한(14W)에 걸려 같은 작업이 2~5배 느린 구간 있음 (D-022) |
| 2026-10-11 | 3-5 | ✅ 완료 | pytest 106개·ruff 통과. 단위: 100k 면 텍스처 구 → 보정 50k 이하(텍스처 색을 정점 색으로 유지), 50k 이하 텍스처 메시 → GLB에 이미지·TEXCOORD_0·baseColorTexture·metallic 0. `/api/health/models`에 남은 VRAM·가중치 캐시 여부·최근 완료 job 실측(생성 시간 중앙값·최대, 최대 VRAM, 사용 가능 수) 추가. 스모크(TripoSR 베이크 job): raw 87k → 베이크 전 감소 50k → 1024 텍스처 → repaired.glb 텍스처 포함 49,998면 USABLE. 발견·수정: UV 섬마다 정점이 나뉜 메시에서 작은 조각 제거가 UV 섬을 지워 면 32% 손실(50k→34k) → 위치 병합 연결성으로 판단, 구멍 채우기가 UV 이음새에 가짜 면 추가 → 텍스처 메시는 건너뜀, trimesh 머티리얼이 금속 기본값으로 어둡게 보이던 문제 (D-023) |
| 2026-10-11 | 3-6 | ✅ 완료 | 합성 그림 10장(정답 마스크 포함, `scripts/make_spike_drawings.py`) × SAM 2 자동 마스크 + TripoSR, `scripts/spike_triposr.py`로 실서버·워커 실행. v1: 완료 8/10(윤곽선·막대 그림 입력 거부), 책상 사진 마스크 IoU 0.144, 보정 후 조각 증가 5장 → 3건 수정(D-024) → v2: 완료·사용 가능 10/10, IoU 평균 0.911, 생성 5.0~5.6초·VRAM 2379MiB. pytest 110개·vitest 37개·typecheck 통과. 결과표 `docs/experiments.md` EXP-001. 실제 손그림은 아직 없음 |
| 2026-10-11 | 4-1 | ✅ 완료 | `evals/manifest.csv`(13행: 공개 샘플 3 + 합성 10, 정답 마스크 10) + `evals/manifest.py`·`validate_manifest.py`. pytest(evals) 8개·ruff 통과. CLI: 실제 manifest 통과(exit 0), 잘못된 행 파일 → 동의 없는 family·저장소 내 family·license 누락·sha256 형식·group 오류 5개 검출(exit 1). EVAL_DATA_DIR 없으면 비공개 행은 건너뜀 표시. CI에 합성 그림 생성 + 검증 추가 (D-025) |
| 2026-10-11 | 4-2 | ✅ 완료 | `evals/benchmark.py`(config YAML: 분할 grabcut·sam2·gt·none × 생성기 × 전처리 × seed) → `config.json`·`per_image.csv`·`summary.json`. 지표: 마스크 IoU·경계 F1·배경 포함률, 생성 성공률·사용 가능률·월드 로딩률(GLB 재로드+충돌체), 조각·non-manifold, 실루엣 IoU(정사영+삼각형 채우기), 시간·VRAM. pytest(evals) 12개 통과. `benchmark.py --config evals/configs/smoke.yaml`(Mock): 3장 사용 가능률 1.0, 실루엣 IoU 0.96~0.99. 처음 실루엣 IoU가 0.55~0.75로 나옴 → fillPoly가 앞·뒷면 겹침을 짝수-홀수로 지운 탓, 삼각형별로 칠하게 수정. 실루엣 함수는 보고서와 공용으로 `app/report/silhouette.py`. CI에 스모크 추가 |
| 2026-10-11 | 4-3 | ✅ 완료 | 분류기 확장: 정면 실루엣 recall<0.85 → MISSING_PART, 마스크 면적>60%·테두리 2변 이상 → BACKGROUND_LEAK, 보고서에 `signals`(실루엣 iou·recall·precision, 마스크 면적·테두리) 기록, benchmark도 같은 신호 사용. 유형별 픽스처 테스트 14개(10개 유형 + 깨끗한 메시 무분류 + 보정 해결 표시) 통과, pytest 124개·evals 12개·1단계 스모크 통과. 3-6에서 남던 degenerate_faces 경고 → 감소 뒤 면적 0 면 제거 단계 추가. non-manifold 픽스처는 검사기가 소수 비율을 INFO로 두는 설계라 모든 면에 지느러미를 붙여 만듦 |
| 2026-10-11 | 4-4 | ✅ 완료 | `evals/compare.py`(요약 지표·미해결 실패 유형·이미지별 변화, 좋아짐/나빠짐 표시). GPU 비교 EXP-002 GrabCut vs SAM 2(합성 10장): 사용 가능률 0.9→1.0, 마스크 IoU 0.838→0.911, 배경 포함률 0.090→0.007 → `docs/experiments.md`. 보고서 화면: 실패 유형 한글 이름, 남은 문제별 행동 버튼(마스크 다시 편집 / 텍스처 굽기로 다시 생성), 정면 모양 일치(실루엣 IoU) 표시. 실서버 확인(Edge): 막대 사람 → 59% 경고색 + 마스크 편집 링크, 페이지 오류 없음. vitest 39개·typecheck, pytest 124개, evals 13개 통과. CI(GitHub Actions)는 gh 미인증으로 결과 직접 확인 못 함. 남은 점: 감소 없는 메시에서 면적 0 면 1개가 검사기 병합 기준 차이로 남음 |
| 2026-10-11 | CI | ✅ 수정 | 4-3 이후 GitHub Actions backend 잡 실패 6회 → 원인: 합성 그림 생성 전에 `pytest evals`, benchmark가 안 쓰는 manifest 행 파일까지 검사. 선택 행만 파일 검사 + 회귀 테스트 + 단계 순서 변경(51f866f). 깨끗한 클론 재현 통과 후 실제 CI 5개 잡 통과. CI 수동 실행(workflow_dispatch)·README 배지·`docs/status.md`(요약·다음 할 일) 추가 |
| 2026-10-12 | 5-1 | ✅ 완료 | `backend/app/edit/`(basis.json·basis·ops·compose) 추가. `test_edit_core.py` 89개 통과: 6패널 오른손 기준·라벨 회전(이미지 축→패널 축), 6패널×(회전 3축·축별 scale·mirror·균일 scale) 매트릭스, 합성 순서·바닥/중앙 맞춤·v0 불변, mirror 면 감김·부피 양수, 텍스처 UV·정점 색 유지·법선 단위 길이, stand_up(원뿔 양방향 → 넓은 쪽 아래, 대칭 막대 +90+안내, z 누움, 이미 섬 noop, 활성 버전 기준), invert_last, 누적 배율(물체 축 기준)·비율 20 거절, 이미 얇은 e0의 회전·두껍게 허용, 상쇄 op noop, 스키마 거절 7종. 백엔드 전체 pytest 213개·ruff check/format 통과 |
