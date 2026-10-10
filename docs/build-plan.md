# Draw2World AI — 4단계 구현 계획

각 단계는 **한 번의 프롬프트로 실행**한다. 단계 끝마다 테스트 통과·실행 확인 후 다음으로.
결정 근거: `docs/proposal.md`. 원 요구사항: `docs/project-brief.md`.

공통 규칙
- 단계 시작 전 `docs/proposal.md`, `docs/decision-log.md` 확인.
- 새 결정은 `docs/decision-log.md`에 추가.
- 완료 조건의 테스트·명령을 실제로 실행해 결과를 보고. 실패하면 완료 아님.
- 사용자 이미지·생성물·가중치·`.env` 커밋 금지.

---

## 1단계 — 뼈대 + 백엔드 코어 + mesh-ready-check (GPU 불필요)

**목표**: Mock 생성기로 업로드→검증→마스크→job→검사→보정→GLB→asset.json→보고서가 API로 끝까지 돈다.

범위
- 루트: `.gitignore`, `.env.example`, `README.md`, `LICENSE`(MIT), `docs/{architecture,model-selection,mesh-quality,experiments,licenses}.md` 초안.
- `packages/mesh-ready-check/`: 독립 pyproject, trimesh만 의존. `inspect(mesh) -> Report`(proposal §6 항목 전부), CLI(`--budget`, `--fail-on`, `--json`). 테스트 픽스처는 코드로 생성(정상 박스, 떠있는 조각, 뒤집힌 면, non-manifold, 종잇장, 바닥 아래).
- `backend/` (Python 3.12, FastAPI, SQLAlchemy+SQLite, Pydantic, Ruff, pytest)
  - `app/input/`: 입력 검사(proposal §1)
  - `app/segmentation/`: `Segmenter` 인터페이스 + `GrabCutSegmenter`(박스·점 지원) + 마스크 후처리
  - `app/preprocess/`: 정규화 RGBA 생성(중앙·전경 비율·여백·해상도·알파 정리), 단계별 이미지 저장
  - `app/generation/`: `ImageTo3DAdapter`(proposal §4) + `MockAdapter` + 레지스트리
  - `app/mesh/`: 보정 파이프라인(단계별 전후 지표·롤백)
  - `app/export/`: GLB 변환, convex hull(≤64점) / bbox 폴백, `asset.json`
  - `app/report/`: 보고서 JSON(원본·보정 지표, outcome, 실패 유형 후보)
  - `app/jobs/`: 상태머신(proposal §5), `job_events`, 워커 `python -m app.worker`(SQLite 폴링·claim, 취소, 실패 기록)
  - `app/api/`: `POST /projects`, `GET /projects/{id}`, `POST /projects/{id}/segment`, `POST /projects/{id}/mask/confirm`, `POST /projects/{id}/jobs`, `GET /jobs/{id}`, `GET /jobs/{id}/events`(SSE), `POST /jobs/{id}/cancel`, `POST /jobs/{id}/retry`, `GET /assets/{id}`, 파일 서빙, `GET /health/models`
- `.github/workflows/ci.yml`: `permissions: contents: read`, Ruff + pytest(backend, mesh-ready-check), 대형 모델 다운로드 없음.
- `assets/samples/`: 테스트용 단순 그림 PNG를 코드로 생성(3장).

완료 조건
- `ruff check` 통과, `pytest` 전체 통과.
- 통합 테스트: 샘플 PNG 업로드 → segment → confirm → job → 워커 1회 실행 → `COMPLETED`, `repaired.glb`·`asset.json`·`report.json` 존재, 스키마 검증.
- 실패 주입 테스트(Mock이 OOM 발생) → `FAILED`, `error_code=CUDA_OOM`, `retryable=true`.

---

## 2단계 — 프론트엔드 전체 화면 (Mock 백엔드로 E2E)

**목표**: 브라우저에서 6개 화면을 따라 그림 업로드부터 월드 조작·보고서 다운로드까지 된다.

범위
- `frontend/`: Vite + React + TS, React Three Fiber, drei, `@react-three/rapier`, Zustand, CSS Modules. `openapi-typescript`로 API 타입 생성.
- 화면 1 업로드: 드래그앤드롭, 지원 조건, 촬영 가이드, 샘플 이미지, 개인정보·보관 기간 안내, 검사 경고 표시.
- 화면 2 객체 선택: 원본/선택 객체/제거될 배경/경계 4종 미리보기, 포함점·제외점·박스·초기화, 확정.
- 화면 3 생성 진행: SSE 단계 타임라인(퍼센트 없음, 단계별 실제 경과 시간), 모델 이름, 로그, 취소·재시도, 실패 시 사용자 메시지.
- 화면 4 3D 결과: orbit 회전·줌, 와이어프레임, 텍스처/정점색 토글, 원본·보정본 나란히 비교, 품질 지표 표, 고지문("한 장의 이미지를 바탕으로 AI가 추정한 3D 모델입니다…").
- 화면 5 월드: proposal §8 (WASD·Q/E·Space·R, orbit 카메라, 밀 수 있는 상자·공, convex hull→bbox 폴백).
- 화면 6 보고서: 모델·시간·지표·보정 전후·outcome, GLB·report.json 다운로드.
- 백엔드 dev 실행 스크립트(API + 워커 동시), Vite proxy.
- CI에 `tsc --noEmit`, `vite build`, vitest(스토어·API 클라이언트·상태 표시 로직) 추가.

완료 조건
- `npm run typecheck`, `npm run build`, `npm test` 통과. 백엔드 테스트 유지.
- 로컬에서 Mock 모드로 샘플 이미지 전체 흐름 수동 확인(실행 명령을 README에 기록).

---

## 3단계 — 실제 AI 연결 (SAM 2 + TripoSR, GPU 워커)

**목표**: GPU 머신에서 실제 그림이 3D가 되어 월드에 들어간다. CI는 계속 Mock.

범위
- `docker/gpu-worker.Dockerfile`(CUDA 12.x, TripoSR 커밋 고정, SAM 2.1, torchmcubes) + WSL2 수동 설치 문서. 가중치는 런타임 다운로드·볼륨 캐시, 커밋 금지.
- `Sam2Segmenter`: 임베딩 캐시, 누적 프롬프트 재예측, multimask 선택, 종이 crop·hole fill. `SEGMENTER=sam2|grabcut`.
- `TripoSRAdapter`: 정규화 RGBA → 회색 합성 512, rembg 미사용, `mc_resolution`, `bake_texture`, 로드/추론 시간·peak VRAM 측정, OOM 시 해상도 낮춰 재시도, 로그 파일.
- `StableFast3DAdapter`: `SF3D_ENABLED` + 라이선스 동의 플래그일 때만 등록. 기본 OFF.
- 보정 강화: quadric 감소(`fast-simplification`), 텍스처 GLB 내장.
- `GET /health/models`에 실제 `validate_environment` 결과.
- GPU 전용 테스트는 `@pytest.mark.gpu`로 분리(CI 제외), 그림 10장 스파이크 스크립트.
- `docs/model-selection.md`, `docs/licenses.md` 실측·출처로 갱신.

완료 조건
- CI(Mock) 계속 통과.
- GPU 머신: `pytest -m gpu` 통과, 샘플 그림 → 월드 배치까지 수동 확인, 스파이크 결과(성공/사용가능/시간/VRAM)를 `docs/experiments.md`에 기록.

---

## 4단계 — 평가·실패 분류·개선 비교

**목표**: 같은 평가셋으로 개선 전후를 수치로 비교하고 실패 유형을 자동 분류한다.

범위
- `evals/manifest.csv` 스키마·검증, 이미지는 외부 경로(`EVAL_DATA_DIR`).
- `evals/benchmark.py`: config(YAML)로 분할기·adapter·전처리 축·seed 조합 실행 → `generation-results/<run_id>/{config.json, per_image.csv, summary.json}`.
- 지표: 마스크 IoU·경계 F1·배경 포함률, 생성 성공률, **사용 가능률**, components, non-manifold, 실루엣 IoU(정사영 + fillPoly), 시간·VRAM, 월드 로딩 성공(GLB 파싱+hull).
- 실패 분류기(규칙 기반): BACKGROUND_LEAK, MISSING_PART, COLLAPSED_BACK, FLOATING_COMPONENT, BROKEN_TEXTURE, NON_MANIFOLD, TOO_MANY_FACES, WRONG_SCALE, INVALID_ORIGIN, COLLISION_FAILURE. 보고서·화면 6에 표시.
- `evals/compare.py`: 두 run 비교 표(markdown) → `docs/experiments.md`에 붙일 형식.
- 프론트 보고서 화면에 실패 유형·해결 안내 추가.
- CI: 공개 샘플 + Mock으로 benchmark 스모크 테스트.

완료 조건
- CI 통과. `python evals/benchmark.py --config evals/configs/smoke.yaml` Mock으로 동작.
- GPU 머신에서 v1 평가셋 1회 이상 실행, 기준선 vs 개선안 비교표를 `docs/experiments.md`에 기록.
