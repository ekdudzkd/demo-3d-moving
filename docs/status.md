# 진행 현황과 다음 할 일 (2026-10-12 기준)

세부 상태와 작업별 로그는 [`IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md), 결정은 [`decision-log.md`](decision-log.md), 측정 결과는 [`experiments.md`](experiments.md)가 기준이다. 이 문서는 그 요약이다.

## 한 줄 요약

계획표 32개 작업 중 31개 완료. 남은 것은 3-4(SF3D, 라이선스 동의 대기) 하나. 5단계(6방향 뷰 + 자연어 전체 변환 편집)까지 끝났다. GitHub Actions CI 5개 잡(backend·frontend·e2e·mesh-ready-check·repo-hygiene)과 Pages 배포가 `main` push마다 돈다.

## 지금까지 한 일

### 1단계 — 백엔드 코어 + mesh-ready-check (GPU 없이)
- FastAPI API + 별도 워커 + SQLite. 작업 상태머신, SSE로 단계 이벤트 전송, 실패 주입(CUDA_OOM 등).
- 입력 검사(크기·대비·객체 수·얇은 그림 경고), GrabCut 분할, 전처리(512 RGBA, 전경 중앙·비율 정규화).
- 생성 모델은 adapter로만 호출. CI·테스트는 MockAdapter.
- `packages/mesh-ready-check`: 메시 검사 패키지·CLI (GPL 의존성 없음).
- 자동 보정(중복 정점·퇴화 면·작은 조각·노멀·구멍·폴리곤 감소·크기·원점/바닥), GLB 변환, 충돌체(convex hull, 실패 시 상자).
- 품질 보고서(보정 전후 비교). 원본·보정 메시 모두 보존.

### 2단계 — 프론트엔드 6개 화면
- 업로드 → 마스크 편집(포함/제외 점·박스) → 생성 진행(SSE 타임라인·취소·재시도) → 3D 뷰어(원본/보정 비교) → 월드(Rapier 물리, WASD·회전·점프) → 결과 보고서.
- Playwright E2E 8개.

### 3단계 — 실제 AI 연결 (RTX 4050 6GB 기준)
- SAM 2.1 hiera-small: 임베딩 캐시, 누적 프롬프트, 재예측 66~115ms.
- TripoSR: 생성 5~7초, 최대 VRAM 2.4GB, 텍스처 베이크, OOM 재시도.
- 보정 강화: 텍스처 유지한 채 50k 면 이하로 감소, `/api/health/models`에 실측 통계.
- 합성 그림 10장 스파이크(EXP-001): 문제 3건 발견·수정 → 10/10 사용 가능, 마스크 IoU 0.911.

### 4단계 — 평가·실패 분류·비교
- `evals/manifest.csv` 평가셋 목록과 검증 스크립트.
- `evals/benchmark.py`: 마스크 IoU·경계 F1·배경 포함률·실루엣 IoU·사용 가능률·월드 로딩률·시간·VRAM.
- 규칙 기반 실패 유형 분류 10종(MISSING_PART, BACKGROUND_LEAK 등).
- `evals/compare.py` 비교표. EXP-002 GrabCut → SAM 2: 사용 가능률 0.9→1.0, 마스크 IoU 0.838→0.911, 배경 포함률 0.090→0.007.
- 보고서 화면에 실패 유형 한글 이름, 고치는 버튼("마스크 다시 편집", "텍스처 굽기로 다시 생성"), 정면 모양 일치율.

### 5단계 — 6방향 뷰 + 자연어 전체 변환 편집 (설계: `docs/designs/view-and-edit.md`)
- 편집 코어(`backend/app/edit/`): 패널 기준표 `basis.json`(Python·TS·JS 공용), 그림 방향 라벨 회전, 90° 회전·축별 크기·반전·세우기·반대로, 범위 검사(축별 0.1~10배, 비율 20).
- 버전: append-only, undo·revert도 새 버전, 실패 버전은 활성 유지. 워커가 v0에서 다시 계산(오차 누적 없음).
- EditPlanner: Mock 한국어 규칙(기본·CI) + Claude 구조화 출력 adapter(`EDIT_PLANNER=claude`). 부분 편집·모양/색 변경·45° 등은 추측하지 않고 거절·질문.
- 화면 `/jobs/:id/edit`: 고정 범위 정사영 6패널·e0 점선 상자·채팅·버전 목록. E2E(세워줘→두껍게→undo).
- Pages 데모에도 같은 규칙을 JS로 옮겨 적용(`pages/edit.js`·`planner.js`). 기대값은 `backend/tests/fixtures/edit_cases.json` 하나를 Python·JS가 같이 검사.

### CI (GitHub Actions)
- `ci.yml`: 금지 파일 검사, mesh-ready-check, 백엔드(ruff·pytest·평가셋·benchmark 스모크·서버 실제 기동 스모크·OpenAPI 계약), 프론트(타입 생성 일치·typecheck·vitest·build·Pages 편집 코어 교차 언어 테스트), Playwright E2E. 수동 실행(workflow_dispatch) 가능.
- `deploy-pages.yml`: `main` push마다 브라우저 데모 배포(`backend/app/edit/basis.json`을 복사해 함께 올림). 같은 그룹의 이전 배포는 취소되고 마지막 push가 반영된다.
- 4-3 이후 CI가 실패하던 문제 수정(51f866f): 합성 그림이 없는 깨끗한 checkout에서 benchmark가 안 쓰는 파일까지 검사하던 것.

## 알려진 한계

- 단일 이미지 3D라 보이지 않는 뒷면은 모델이 추정한다. 정밀 복원이 아니다.
- 가는 선 그림(막대 사람)은 TripoSR이 일부만 살린다 (정면 모양 일치 59%). 분할이 아니라 생성 모델의 한계.
- TripoSR은 seed와 관계없이 같은 결과를 낸다. "다시 생성"으로는 결과가 바뀌지 않는다.
- 평가는 코드로 만든 합성 그림 10장 + 공개 샘플 3장뿐. 실제 손그림으로는 검증 안 됨.
- 실제 모델 실행은 로컬 GPU 서버에서만 가능. GitHub Pages 데모는 Mock 실루엣 돌출 + 6방향 편집을 브라우저 안에서만 돌린다(버전은 새로고침하면 사라짐).
- 6방향 편집은 물체 전체 변환(회전·크기·반전)만. 부분 편집·모양 추가는 v2 후보.

## 다음 할 일

우선순위 순.

| 순위 | 할 일 | 왜 | 막힌 것 |
|---|---|---|---|
| 1 | 실제 손그림 평가셋 수집 (동의서 포함, `EVAL_DATA_DIR`) → GrabCut/SAM 2·TripoSR benchmark 재실행 | 합성 그림 결과가 실제에서도 맞는지 확인 | 손그림·보호자 동의 필요 |
| 2 | MVP 완료 점검표: project-brief §24 14개 시나리오를 GPU 서버에서 한 번에 통과시키고 기록 | 완료 정의(IMPLEMENTATION_PLAN §5) 확정 | 없음 |
| 3 | 3-4 StableFast3DAdapter (플래그 ON 시에만 등록) → TripoSR과 EXP 비교 | 가는 선·뒷면 품질 개선 후보, 생성기 비교 | Stability AI 라이선스 동의 + Hugging Face 게이트 토큰 |
| 4 | 가는 선 그림 대응: 전처리에서 선 두께 보강 또는 MISSING_PART 시 안내 개선 | 막대 그림류 실패 | 없음 |
| 5 | GPU 워커 Docker 이미지 재빌드·검증 (`MODEL_CACHE_DIR=/data/models`, EGL 라이브러리 추가분) | Dockerfile 변경 후 아직 빌드 안 함 | 디스크 공간 |
| 6 | 감소 없는 메시에서 면적 0 면 1개가 남는 문제 (보정과 검사기의 정점 병합 기준 차이) | 경고 1건 잔존 | 없음 |
| 7 | 공개 데모: GPU 서버 호스팅 또는 녹화 데모 영상 | 로컬 밖에서 체험 | GPU 서버 비용 |

## 실행 방법 (요약)

- CI와 같은 확인: `pytest -q` (backend), `pytest -q evals`, `npm test` (frontend), `node --test "pages/tests/*.test.mjs"` (Pages 편집 코어), `bash scripts/smoke_stage1.sh`.
- 로컬 플레이(GPU): WSL venv에서 `SEGMENTER=sam2 GENERATOR=triposr bash scripts/dev-backend.sh` + `cd frontend && npm run dev` → http://127.0.0.1:5391. 자세한 설정은 [`gpu-setup.md`](gpu-setup.md).
