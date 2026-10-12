# Draw2World AI

[![CI](https://github.com/jngbnss/draw2world-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/jngbnss/draw2world-ai/actions/workflows/ci.yml)

그림 한 장을 업로드하면 객체를 분리하고 3D 모델로 만든 뒤, 메시 품질을 검사·보정해서 작은 가상 공간에서 움직여볼 수 있게 하는 서비스.

```
이미지 입력 → 입력 검사 → 객체 분할(SAM 2) → 사용자 마스크 확인 → 정규화
→ 3D 생성(TripoSR) → 메시 검사 → 자동 보정 → GLB → 충돌체 → 웹 월드
```

**브라우저 데모:** https://jngbnss.github.io/draw2world-ai/ — 샘플·직접 그리기·업로드 → 분할 → 3D 메시 → 검사·보정 → 3D 월드. GPU 모델 대신 MockAdapter와 같은 실루엣 돌출(로컬 기하 대체)로 동작한다 (`pages/`).

> 한 장의 이미지를 바탕으로 AI가 추정한 3D 모델입니다. 보이지 않는 부분은 실제 모습과 다를 수 있습니다.

## 상태

MVP 개발 중. 요약과 다음 할 일은 [`docs/status.md`](docs/status.md), 작업별 상태는 [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

## 문서

| 문서 | 내용 |
|---|---|
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | 설계, 디렉토리 구조, 작업별 진행 상태 |
| [docs/proposal.md](docs/proposal.md) | 설계 제안 (입력 조건, adapter, 상태 모델, 검사 항목, 위험) |
| [docs/architecture.md](docs/architecture.md) | 아키텍처 |
| [docs/decision-log.md](docs/decision-log.md) | 결정 기록 |
| [docs/licenses.md](docs/licenses.md) | 사용 모델·라이브러리 라이선스 |
| [docs/experiments.md](docs/experiments.md) | 실험 기록 |

## 빠른 시작

### 1. 백엔드 (Linux 또는 WSL2, Python 3.12)

```bash
cp .env.example .env
python -m venv .venv && . .venv/bin/activate
pip install -e packages/mesh-ready-check -e "backend[dev]"
PY=.venv/bin/python bash scripts/dev-backend.sh   # API(:8077) + 생성 워커
```

### 2. 프론트엔드 (Node 20+, Windows·macOS·Linux)

```bash
cd frontend
npm install
npm run dev        # http://localhost:5391  (/api는 :8077로 프록시)
```

화면: 업로드 → 객체 선택(마스크 수정) → 생성 진행 → 3D 결과 → 월드(WASD·Q/E·Space·R) → 보고서

### 테스트

| 대상 | 명령 |
|---|---|
| mesh-ready-check | `cd packages/mesh-ready-check && pytest` |
| 백엔드 | `cd backend && pytest` |
| 1단계 통합 스모크 | `PY=python bash scripts/smoke_stage1.sh` |
| 프론트 단위 | `cd frontend && npm run typecheck && npm test && npm run build` |
| E2E (백엔드·프론트 실행 중, `MOCK_DELAY_MS=1500` 권장) | `cd frontend && npx playwright test` (로컬 Edge, CI는 chromium) |
| API 계약 갱신 | `python scripts/export_openapi.py && (cd frontend && npm run gen:api)` |

- API 문서: http://localhost:8077/docs
- 테스트: `cd backend && pytest`
- 전체 흐름 스모크: `PY=python bash scripts/smoke_stage1.sh`
- 기본값은 `GENERATOR=mock`(실루엣 돌출, AI 아님), `SEGMENTER=grabcut`. 실제 모델은 3단계.

## 개발 환경 메모

- Python 작업은 Linux 또는 WSL2에서 한다. Windows에서 **스마트 앱 컨트롤**이 켜져 있으면 numpy 등 서명 없는 DLL이 차단되어 import가 실패한다 (D-013).
- 패키지별 테스트 예: `cd packages/mesh-ready-check && pip install -e ".[dev]" && pytest`

## 기여 규칙

- 사용자 이미지, 생성물, 모델 가중치, `.env`는 커밋하지 않는다. CI가 `scripts/check_forbidden_files.sh`로 검사한다.
- 작업 절차는 `IMPLEMENTATION_PLAN.md` §0.

## 라이선스

코드: MIT ([LICENSE](LICENSE)). 외부 모델·가중치는 각자의 라이선스를 따른다 ([docs/licenses.md](docs/licenses.md)).
