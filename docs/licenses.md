# 라이선스 기록

> 법률 자문이 아니다. 배포 전 각 원문을 다시 확인하고 "확인일"을 갱신한다.
> 상태: `미확인`(공개 정보 기준 기재, 원문 대조 전) / `확인`(원문 대조 완료).

## AI 모델

| 대상 | 코드 | 가중치 | 상업 이용 | 우리 사용 방식 | 출처 | 상태 · 확인일 |
|---|---|---|---|---|---|---|
| TripoSR | MIT | MIT | 가능 | 기본 생성 모델 | github.com/VAST-AI-Research/TripoSR, huggingface.co/stabilityai/TripoSR | 미확인 |
| SAM 2 / 2.1 | Apache-2.0 | Apache-2.0 | 가능 (NOTICE 유지) | 객체 분할 | github.com/facebookresearch/sam2 | 미확인 |
| Stable Fast 3D | Stability AI Community License | 동일 | **조건부** (매출 한도 등) | 실험 전용, `SF3D_ENABLED` + `SF3D_LICENSE_ACCEPTED` 필요, 기본 OFF | github.com/Stability-AI/stable-fast-3d, stability.ai/community-license-agreement | 미확인 |
| rembg / U²-Net | — | — | — | **사용 안 함** (TripoSR 기본 전처리 경로 비활성) | — | — |

## 라이브러리

| 대상 | 라이선스 | 주의 | 상태 |
|---|---|---|---|
| trimesh | MIT | mesh-ready-check 핵심 의존성 | 미확인 |
| fast-simplification | MIT | 폴리곤 감소 | 미확인 |
| Open3D | MIT | 선택 | 미확인 |
| **PyMeshLab** | **GPL-3.0** | mesh-ready-check(MIT)에 import 금지. 필요 시 외부 프로세스·선택 기능으로만 | 미확인 |
| **Blender** | **GPL** | headless 외부 프로세스 호출만. 출력물은 GPL 적용 대상 아님 | 미확인 |
| OpenCV | Apache-2.0 | — | 미확인 |
| Pillow | MIT-CMU (HPND) | — | 미확인 |
| FastAPI / Pydantic / SQLAlchemy | MIT | — | 미확인 |
| Three.js | MIT | — | 미확인 |
| React Three Fiber / drei | MIT | — | 미확인 |
| Rapier (rapier.js) | Apache-2.0 | — | 미확인 |

## 데이터·개인정보

- 평가 이미지는 팀원·동의한 가족이 직접 그린 것만 사용. 아동 그림은 보호자 동의서 보관.
- 원본 이미지는 저장소 밖에 보관, 저장소에는 `evals/manifest.csv`만.
- 공개 샘플(`assets/samples/`)은 팀 제작 CC0.
- 서버 업로드는 EXIF 제거, 기본 24시간 후 삭제(`RETENTION_HOURS`).
