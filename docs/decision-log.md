# Decision Log

형식: ID · 날짜 · 결정 · 이유 · 대안

| ID | 날짜 | 결정 | 이유 | 대안 |
|---|---|---|---|---|
| D-001 | 2026-10-11 | 분할은 Project(대화형), 생성은 GenerationJob(비동기)로 분리. Job 상태에서 SEGMENTING 제외 | 분할은 사용자 확인 필요. job이 사용자 입력 대기로 멈추면 안 됨 | 원안대로 job에 포함 |
| D-002 | 2026-10-11 | 작업 큐 = SQLite job 테이블 + 워커 프로세스 1개. Celery·Redis 미사용 | GPU 1장, 동시성 1. 운영 단순화 | Celery+Redis, RQ |
| D-003 | 2026-10-11 | `workers/` 폴더 대신 `backend/app/<stage>/` + `python -m app.worker` | 로직 중복 방지 | 원안 workers/ 3개 |
| D-004 | 2026-10-11 | API는 Python 3.12, GPU 워커는 Docker/WSL2 별도 환경(3.10/3.11 허용) | torchmcubes·CUDA 빌드 호환성 | 단일 3.12 환경 |
| D-005 | 2026-10-11 | mesh-ready-check는 `packages/`의 독립 MIT 패키지, trimesh만 의존 | OSS 공개, PyMeshLab GPL 회피 | 백엔드 내부 모듈 |
| D-006 | 2026-10-11 | Adapter는 정규화 RGBA만 입력받음. 배경 제거는 adapter 밖 | 분할·전처리 실험을 모델과 독립적으로 비교 | 모델별 내장 전처리(rembg) |
| D-007 | 2026-10-11 | 진행 표시는 SSE 단계 이벤트, 퍼센트 없음 | 가짜 진행률 금지 원칙 | WebSocket, 폴링 |
| D-008 | 2026-10-11 | 프론트 3D = React Three Fiber + @react-three/rapier | 선언형 씬, Rapier 공식 바인딩 | 순수 Three.js |
| D-009 | 2026-10-11 | 충돌체 기본 convex hull(≤64점), 실패 시 bbox | 생성 메시 직접 충돌 금지 원칙 | 항상 bbox |
| D-010 | 2026-10-11 | 평가 원본 이미지는 저장소 밖. manifest·체크섬만 커밋. 공개 샘플은 팀 제작 CC0 | 아동 이미지 개인정보 | 저장소 내 보관 |
| D-011 | 2026-10-11 | SF3D는 플래그+라이선스 동의 시에만 활성, 기본 OFF | Community License 조건부 | 동일 취급 |
| D-012 | 2026-10-11 | 저장소 라이선스 MIT | TripoSR(MIT)·SAM2(Apache) 호환 | Apache-2.0 |
