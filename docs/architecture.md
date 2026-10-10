# 아키텍처

> 초안. 전체 설계와 디렉토리 구조는 `IMPLEMENTATION_PLAN.md` §1~§3이 기준이다. 이 문서는 구현하면서 실제 구조·데이터 흐름이 정해질 때마다 상세를 채운다.

## 구성 요소

| 구성 | 실행 형태 | 역할 |
|---|---|---|
| frontend | Vite 정적 앱 | 6개 화면, 3D 뷰어, Rapier 월드 |
| API 서버 | FastAPI (uvicorn) | 업로드, 입력 검사, 분할, job 생성, SSE, 파일 서빙 |
| 워커 | `python -m app.worker` (동시성 1) | 전처리 → 생성 → 검사 → 보정 → 내보내기 → 보고서 |
| DB | SQLite | projects, masks, jobs, job_events, assets |
| 파일 저장소 | `data/` | 원본·마스크·중간 이미지·메시·보고서 |
| GPU 워커 환경 | Docker / WSL2 | TripoSR, SAM 2 (3단계) |

## 경계

- **분할(대화형)** 은 API 서버, **생성(비동기)** 은 워커. (D-001)
- 모델 호출은 `ImageTo3DAdapter`, 분할은 `Segmenter` 인터페이스로만. (D-006)
- 품질 판정은 서버, 표시는 클라이언트.

## 미정 (구현 중 채움)

- 워커 job claim 쿼리와 동시성 보장 방식 — 1-8
- SSE 재연결 시 이벤트 재전송 방식 — 1-8
- 파일 서빙 경로 검증 — 1-3/1-4
