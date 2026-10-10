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

## 구현 메모

- **job claim**: 가장 오래된 QUEUED id를 고른 뒤 `UPDATE ... WHERE id=? AND status='QUEUED'`로 상태를 바꾸고 rowcount가 1일 때만 가져간다. SQLite는 WAL + busy_timeout.
- **SSE**: `job_events.seq`를 이벤트 id로 쓴다. 재연결 시 `Last-Event-ID`(또는 `?after=`) 이후만 다시 보낸다. 종료 상태면 `event: end`.
- **파일 서빙**: `/api/files/{path}`는 `data/projects` 하위로 resolve되는 파일만 허용 (`Storage.resolve_public`).
- **단계 독립성**: 각 단계는 job 디렉터리의 정해진 파일을 읽고 쓰며, 결과 요약만 `jobs.result`(JSON)에 합친다.
- **워커 재시작**: 시작 시 실행 상태로 남은 job을 FAILED(INTERNAL, 재시도 가능) 처리.
- **보관 기간**: 워커가 10분마다 `RETENTION_HOURS`가 지난 프로젝트(실행 중 제외)를 DB·파일 모두 삭제.
