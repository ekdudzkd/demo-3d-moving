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
| D-013 | 2026-10-11 | Python 개발·테스트는 WSL2(Ubuntu)에서 실행. venv는 WSL 홈(`~/.venvs/`)에 둠 | 개발 PC의 Windows 스마트 앱 컨트롤이 numpy DLL 로드를 차단. GPU 워커도 Linux 계획(D-004)이라 일관됨 | 스마트 앱 컨트롤 끄기(되돌릴 수 없음), conda |
| D-014 | 2026-10-11 | mesh-ready-check 위상 검사는 위치 병합 사본으로, 중복 정점은 위치+UV 기준으로 셈 | UV 경계 정점을 구멍·중복으로 오판 방지 | 원본 메시 그대로 검사 |
| D-015 | 2026-10-11 | 마스크 후처리에서 테두리에 닿지 않는 구멍은 크기와 무관하게 채움. 제외점이 찍힌 구멍만 유지 | 그림은 윤곽선만 선택되고 안쪽이 비는 경우가 흔함. 진짜 구멍은 드물고 사용자가 제외점으로 지정 가능 | 전경 1% 미만 구멍만 채움 (proposal 원안) |
| D-016 | 2026-10-11 | 밝기 보정은 전경 L 범위(1~99 백분위)가 100 미만일 때만 적용 | 깨끗한 색칠 그림의 색을 바꾸지 않기 위해. 어둡거나 흐린 사진만 대상 | 항상 적용 |
| D-017 | 2026-10-11 | 개발 포트: 백엔드 8077, 프론트 5391 | 개발 PC에서 5173·5180·8000이 다른 앱에 점유됨 (Windows 8000은 다른 Python 앱). 기본값과 겹치지 않게 | 5173/8000 기본값 |
| D-018 | 2026-10-11 | 프론트는 Windows Node, 백엔드는 WSL. Vite 프록시가 WSL localhost 포워딩으로 백엔드에 연결 | esbuild·rollup Windows 바이너리는 스마트 앱 컨트롤에 막히지 않음. Python 네이티브만 문제 (D-013) | 프론트도 WSL |
| D-019 | 2026-10-11 | GLB는 비금속 기본 머티리얼·노멀·linear 정점 색으로 쓴다. mesh-ready-check는 glTF 속성(COLOR_0·TEXCOORD_0·baseColorTexture)을 직접 읽는다 | trimesh 기본 출력은 머티리얼이 없어 glTF 기본값(metallic 1.0)으로 어둡게 보였고, 머티리얼을 넣으면 trimesh가 읽을 때 COLOR_0을 버려 색 검사가 틀림 | 프론트에서만 머티리얼 보정 |
| D-020 | 2026-10-11 | GPU 환경에서 torchmcubes 대신 scikit-image marching cubes 대체 모듈, rembg는 빈 모듈. CUDA 툴킷 설치 불필요 | torchmcubes는 CUDA 툴킷 버전을 맞춰 소스 빌드해야 해 설치가 자주 실패. marching cubes는 CPU로도 1~2초 수준이라 병목이 아님. rembg는 쓰지 않음(D-006) | torchmcubes 소스 빌드, PyMCubes |
| D-021 | 2026-10-11 | SAM 2 임베딩 캐시 키는 이미지(종이 crop 후) 내용 해시. 메모리 LRU 8개 + `data/cache/sam2/*.pt`, 보관 기간 지나면 함께 삭제. 박스가 없으면 전경 추정 bbox(512 축소본)를 박스로, 후보 3개 중 coverage 0.2%~90% 밖·제외점 포함 후보를 버리고 점수 최고. 사진 속 종이가 이미지 90% 미만이면 종이 bbox로 잘라 분할 | Segmenter 인터페이스(image, prompts)를 그대로 두고 프로젝트 id 없이 캐시. 임베딩도 사용자 이미지 파생물이라 보관 정책 적용. 박스 없이 점만 주면 SAM이 종이·부분을 잡는 경우가 많음 | 프로젝트 id로 캐시(인터페이스 변경), 이전 low-res 마스크를 mask_input으로 전달 |
| D-022 | 2026-10-11 | TripoSR 출력은 (z 위, 정면 +x) → (y 위, 정면 +z, 이미지 오른쪽 +x)로 회전해 raw.obj에 저장. CUDA OOM이면 캐시 비우고 chunk 2048·mc ≤192로 1회 재시도, 사용한 옵션을 결과에 기록. 텍스처 베이크는 TripoSR의 아틀라스·래스터만 쓰고 색 질의는 모델 장치에서 직접, 실패하면 정점 색 + 경고. 기본 chunk 65536 | 검사·보정·뷰어가 y 위·정면 +z 규약(Mock과 동일). 원본 bake_texture는 GPU에서 장치 불일치로 항상 실패. chunk 65536은 4050에서 2배 빠르고 최대 VRAM 같음 | gradio 방향 변환 그대로, OOM 즉시 실패, 베이크 미지원 |
| D-023 | 2026-10-11 | 텍스처 베이크는 면 예산까지 감소한 뒤에 굽는다. 보정에서 예산 초과 텍스처 메시는 텍스처 색을 정점 색으로 옮겨 감소. 텍스처 보정본은 repaired.glb(정점 색은 PLY 유지). 작은 조각 판정은 위치 병합 연결성, 텍스처 메시는 구멍 채우기 생략. GLB의 모든 머티리얼은 metallic 0·doubleSided | quadric 감소(fast-simplification)는 UV를 보존하지 못함. 텍스처 메시는 UV 섬마다 정점이 나뉘어 split·fill_holes가 섬과 이음새를 조각·구멍으로 오인 | UV 보간 감소(이음새 깨짐), 텍스처 항상 정점 색으로 변환 |
| D-024 | 2026-10-11 | 입력 검사의 객체 크기는 구멍을 채운 실루엣 기준. 실루엣이 작아도 bbox가 10% 이상이면 거부 대신 `thin_drawing` 경고. 대비는 실루엣·배경 색 중앙값으로 비교. SAM 2 종이 crop 때 종이 밖 픽셀을 종이색으로 덮음. 보정에 감소 뒤 작은 조각 제거 단계 추가 | 3-6 스파이크: 윤곽선만 그린 그림이 잉크 1.6%로 거부, 기울어진 종이 사진의 bbox 모서리 책상색 때문에 종이 전체가 물체로 잡힘, quadric 감소가 얇은 연결부를 끊어 조각 1→4 | 잉크 기준 유지·최소 비율만 낮춤(작은 물체 사진까지 통과), 종이를 원근 보정(구현 큼) |
