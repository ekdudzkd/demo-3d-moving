# Draw2World AI 프로젝트 개발 프롬프트 (원문)

> 이 파일은 팀이 합의한 원본 요구사항이다. 변경·보완 결정은 `docs/proposal.md`, `docs/decision-log.md`가 우선한다.

## 1. 프로젝트 개요

Draw2World AI는 사용자가 직접 그린 그림이나 한 장의 이미지를 업로드하면 AI가 객체를 분리하고 3D 모델로 변환한 뒤, 사용자가 해당 모델을 회전·이동하거나 작은 가상 공간에서 조작할 수 있게 만드는 AI 콘텐츠 제작 서비스다.

핵심 목표는 단순히 3D 파일을 생성하는 것이 아니다.

생성된 결과를 실제 인터랙티브 콘텐츠에서 사용할 수 있도록 다음 과정을 자동화한다.

이미지 입력 → 객체 분리 → 이미지 정규화 → 3D 생성 → 메시 검사 → 메시 보정 → GLB 변환 → 충돌체 생성 → 인터랙티브 월드 배치

첫 MVP는 어린이가 그린 사물 하나를 3D 오브젝트로 만들어 작은 방 안에서 움직이고 관찰하는 경험으로 구현한다.

## 2. 현실적인 기술 범위

한 장의 이미지만으로 객체 뒤쪽과 가려진 형태를 정확하게 복원하는 것은 불가능하다.

AI가 생성한 3D 결과는 실제 물체를 정밀 복원한 것이 아니라 입력 이미지에서 추정한 형태다.

서비스 화면에 다음 내용을 표시한다.

> 한 장의 이미지를 바탕으로 AI가 추정한 3D 모델입니다. 보이지 않는 부분은 실제 모습과 다를 수 있습니다.

첫 MVP에서는 다음을 약속하지 않는다.

- 정확한 치수 복원
- 제조 가능한 CAD 모델
- 완벽한 뒤쪽 형태
- 자동 리깅
- 모든 그림의 캐릭터 애니메이션
- 여러 물체가 포함된 복잡한 장면의 완전한 3D 변환

## 3. MVP 사용자 경험

1. 사용자가 그림 또는 이미지를 업로드한다.
2. 시스템이 이미지에서 주 객체를 찾는다.
3. 사용자가 객체 마스크를 확인하고 필요하면 수정한다.
4. 배경을 제거하고 객체 이미지를 정규화한다.
5. 3D 생성 모델을 실행한다.
6. 생성 진행 상태를 보여준다.
7. 생성된 모델을 3D 뷰어에서 확인한다.
8. 사용자는 모델을 회전·확대·축소한다.
9. 시스템이 메시 품질을 검사한다.
10. 모델을 작은 가상 공간에 배치한다.
11. 사용자는 키보드나 마우스로 오브젝트를 움직인다.
12. 생성 결과와 품질 보고서를 다운로드한다.

## 4. MVP 범위

### 포함

- 이미지 1장 업로드
- 객체 1개 선택
- 배경 제거
- 3D 모델 1개 생성
- 메시 자동 검사
- 기본 메시 보정
- GLB 또는 OBJ 변환
- 웹 3D 미리보기
- 기본 충돌체 생성
- 작은 가상 공간 배치
- 이동·회전·점프 중 최소 2개 조작
- 생성 결과 비교 및 품질 지표

### 제외

- 여러 객체가 포함된 장면 전체 변환
- 자동 골격 생성
- 사람·동물의 완전한 애니메이션
- 음성 대화
- 거대한 3D 오픈월드
- 모바일 앱
- 실제 CAD 변환
- 정밀 3D 스캔
- 영상에서 3D 생성
- 사용자 간 멀티플레이

## 5. 추천 기술 스택

### 프론트엔드

- React, TypeScript, Vite
- Three.js 또는 React Three Fiber
- Rapier
- Zustand
- WebSocket 또는 Server-Sent Events
- CSS Modules 또는 Tailwind CSS

### 백엔드

- Python 3.12, FastAPI, Pydantic, SQLAlchemy, SQLite
- Celery 또는 간단한 작업 큐
- Redis는 실제로 필요한 경우에만 사용
- pytest, Ruff

### AI·컴퓨터 비전

- TripoSR, SAM 2, OpenCV, Pillow
- 선택 사항: Stable Fast 3D, MMPose, CLIP 계열 이미지 임베딩

### 3D 처리

- Blender, trimesh, PyMeshLab, Open3D, glTF 또는 GLB, Three.js, Rapier

각 모델의 코드와 가중치 라이선스를 별도로 확인한다.

Stable Fast 3D는 일반적인 MIT·Apache 라이선스가 아닌 Stability AI Community License를 사용하므로 TripoSR과 같은 조건이라고 가정하지 않는다.

라이선스 정보는 `docs/licenses.md`에 기록한다.

## 6. 전체 처리 구조

이미지 업로드 → 입력 이미지 검사 → 주 객체 감지 → SAM 2 객체 분할 → 사용자 마스크 확인 → 배경 제거 → 크기·위치·밝기 정규화 → TripoSR 3D 생성 → 메시 품질 검사 → 자동 보정 → GLB 변환 → 충돌체 생성 → Three.js 월드 로딩

각 단계를 독립적인 작업으로 분리한다. 하나의 함수에서 전체 파이프라인을 실행하지 않는다.

## 7. 입력 이미지 검사

지원 조건:

- PNG, JPG, WEBP
- 설정된 최대 파일 크기 이하
- 최소 해상도 이상
- 이미지 한 장에 주 객체 하나
- 객체가 이미지 중앙에 가까움
- 객체가 지나치게 잘리지 않음
- 투명 배경 지원

검사 결과 예시:

```json
{
  "is_valid": true,
  "width": 1024,
  "height": 1024,
  "object_count": 1,
  "object_coverage": 0.61,
  "warnings": []
}
```

사용자에게 다음 문제를 안내한다: 객체가 너무 작음 / 객체 일부가 잘림 / 배경과 객체의 색이 비슷함 / 여러 객체가 겹침 / 이미지가 지나치게 흐림 / 투명 영역이 잘못됨

## 8. Object Segmentation

SAM 2를 사용해 주 객체의 마스크를 생성한다.

사용자는 다음 방식으로 마스크를 수정할 수 있다: 객체를 클릭해 선택 / 포함할 영역에 점 추가 / 제외할 영역에 점 추가 / 사각형으로 객체 지정 / 마스크 초기화

AI가 생성한 마스크를 바로 3D 모델에 전달하지 않는다. 사용자가 미리보기에서 원본 이미지, 선택된 객체, 제거될 배경, 마스크 경계를 확인할 수 있어야 한다.

평가 지표: IoU, 경계 정확도, 객체 누락률, 배경 포함률, 사용자 수정 횟수, 처리 시간

## 9. Image Preprocessor

3D 생성 전에 다음 전처리를 수행한다: 배경을 투명 또는 단색으로 변경 / 객체를 정사각형 캔버스 중앙에 배치 / 객체 크기 정규화 / 여백 추가 / 밝기와 대비 조정 / 알파 경계 정리 / 작은 노이즈 제거 / 이미지 해상도 정규화

모든 전처리 결과를 저장해 비교할 수 있게 한다. 전처리 적용 전과 후의 3D 생성 결과를 동일한 입력으로 비교한다.

## 10. 3D Generation Adapter

3D 생성 모델을 교체할 수 있도록 adapter 인터페이스를 만든다.

```
interface ImageTo3DAdapter {
  generate(inputImagePath, options): GenerationResult;
  getModelInfo(): ModelInfo;
  validateEnvironment(): EnvironmentStatus;
}
```

```json
{
  "job_id": "job-001",
  "model_name": "triposr",
  "mesh_path": "",
  "texture_paths": [],
  "generation_time_ms": 0,
  "peak_vram_mb": 0,
  "warnings": []
}
```

초기 adapter: TripoSRAdapter. 비교 실험용 adapter: StableFast3DAdapter.

모델에 따라 라이선스와 하드웨어 요구사항이 다르므로 같은 adapter라고 해서 동일한 방식으로 배포하지 않는다.

## 11. 생성 작업 관리

작업 상태: QUEUED, PREPROCESSING, SEGMENTING, GENERATING, VALIDATING, REPAIRING, EXPORTING, COMPLETED, FAILED

사용자 화면에 실제 단계를 표시한다. 가짜 진행률을 보여주지 않는다. 실제 세부 진행률을 알 수 없다면 퍼센트 대신 현재 작업 단계를 표시한다.

실패 시 남길 정보: 실패 단계, 오류 종류, 사용자에게 보여줄 설명, 재시도 가능 여부, 모델 로그, 입력 설정

## 12. Mesh Quality Inspector

팀이 직접 개발하는 핵심 모듈.

검사 항목: 정점 수, 면 수, 연결된 메시 개수, 분리된 작은 조각, 열린 경계, 뒤집힌 노멀, 중복 정점, 비정상적으로 긴 면, non-manifold edge, 텍스처 존재 여부, UV 존재 여부, 모델 크기, 원점 위치, 바닥 아래로 내려간 부분, 지나치게 높은 폴리곤 수

```json
{
  "is_usable": true,
  "vertex_count": 48231,
  "face_count": 93120,
  "connected_components": 2,
  "non_manifold_edges": 14,
  "has_uv": true,
  "has_texture": true,
  "centered": false,
  "grounded": false,
  "warnings": []
}
```

단순히 파일이 생성됐다는 이유로 성공 처리하지 않는다.

## 13. Mesh Repair Pipeline

자동 보정 후보: 중복 정점 병합, 작은 분리 조각 제거, 노멀 재계산, 구멍 일부 보정, 모델 중앙 정렬, 모델 크기 정규화, 바닥 위치 정렬, 폴리곤 감소, GLB 변환, 텍스처 경로 정리

자동 보정 전후의 품질 수치를 기록한다. 보정으로 메시가 더 손상될 가능성이 있으면 원본과 보정본을 모두 보존한다.

## 14. Interactive Asset Builder

```json
{
  "asset_id": "asset-001",
  "display_name": "My Drawing",
  "mesh_url": "",
  "scale": 1.0,
  "spawn_position": [0, 1, 0],
  "collision_type": "convex_hull",
  "interaction_type": "movable",
  "mass": 1.0
}
```

지원 충돌체: bounding box, bounding sphere, convex hull. 복잡한 생성 메시를 그대로 물리 충돌체로 사용하지 않는다.

## 15. 캐릭터 조작 범위

자동 리깅이 없는 모델을 억지로 사람처럼 걷게 만들지 않는다. MVP에서는 모델 전체를 하나의 오브젝트로 취급한다.

가능한 조작: 이동, 회전, 점프, 밀기, 크기 변경, 바닥 위 배치. 걷기·관절 애니메이션은 별도 확장 단계.

## 16. 리깅 확장 단계

MVP 완료 후 진행. 리깅 가능 여부 먼저 분류(사람·동물 형태, 팔다리 분리, 정면/측면 식별, 메시 붕괴 없음). 후보: MMPose, Blender Rigify, 자동 뼈대 매핑, 휴머노이드 템플릿, 수동 관절 보정 UI. 리깅 실패 시 정적 오브젝트로 되돌아갈 수 있어야 한다.

## 17. 비교 실험

- 객체 분할 비교: 배경 제거 없음 / OpenCV 단순 배경 제거 / SAM 2 / SAM 2 + 사용자 수정. 평가: 마스크 IoU, 3D 생성 성공률, 배경이 메시로 생성되는 비율, 사용자 만족도
- 3D 생성 모델 비교: TripoSR, Stable Fast 3D (추가 후보는 라이선스·환경 확인 후). 평가: 생성 시간, VRAM, 메시 생성 성공률, connected component 수, non-manifold edge 수, 입력-렌더 유사도, 사용자 선호도, 월드 로딩 성공률
- 전처리 실험: 객체 크기, 배경색, 투명 배경, 밝기, 여백, 해상도. 한 가지 조건씩 변경.

## 18. AI 역량 증명

1. 3D 생성 모델 후보 비교 2. 입력 이미지 실패 유형 분석 3. SAM 2 전처리 효과 측정 4. 메시 품질 자동 판정 5. 실패 결과 유형별 분류 6. 전처리·후처리 개선 7. 개선 전후 성공률 비교 8. 실행 시간·GPU 사용량 최적화

> 이미지→3D 모델을 단순 실행한 것이 아니라, 객체 분할·입력 정규화·생성 모델 비교·메시 검사·자동 보정 과정을 설계하고 실제 게임 자산 사용률을 높였다.

## 19. 실패 유형 분류

BACKGROUND_LEAK, MISSING_PART, COLLAPSED_BACK, FLOATING_COMPONENT, BROKEN_TEXTURE, NON_MANIFOLD, TOO_MANY_FACES, WRONG_SCALE, INVALID_ORIGIN, COLLISION_FAILURE, RIGGING_UNSUITABLE

각 실패 유형의 빈도와 해결 방법을 기록한다.

## 20. 화면 구성

1. 이미지 업로드: 그림 업로드, 지원 조건, 샘플 이미지, 개인정보 및 저장 안내
2. 객체 선택: 원본, SAM 2 마스크, 포함·제외 영역 지정, 배경 제거 미리보기
3. 생성 진행: 현재 작업 단계, 모델 이름, 진행 로그, 취소 및 재시도
4. 3D 결과: 회전, 확대·축소, 와이어프레임, 텍스처 전환, 품질 검사 결과, 원본·보정본 비교
5. 인터랙티브 월드: 모델 배치, 이동, 회전, 점프 또는 물리 상호작용, 카메라 이동
6. 결과 보고서: 사용한 모델, 생성 시간, 메시 품질, 보정 전후 차이, 사용 가능 여부, GLB 다운로드

## 21. 저장소 구조 (원안)

```
draw2world-ai/
├─ frontend/src/{components,features/{upload,segmentation,generation,model-viewer,quality-report,world},three,services,types}, frontend/tests
├─ backend/app/{api,jobs,segmentation,generation,mesh,export,core}, backend/tests
├─ workers/{segmentation_worker,generation_worker,mesh_worker}
├─ evals/{input-images,segmentation-labels,generation-results,benchmark.py}
├─ assets/demo-world/
├─ docs/{architecture,model-selection,mesh-quality,experiments,decision-log,licenses}.md
├─ .github/workflows/ci.yml
├─ .env.example, LICENSE, README.md
```

## 22. OSS 역량 증명

기록: TripoSR 입력·출력 구조 분석, SAM 2 마스크 처리, trimesh/PyMeshLab 메시 검사, Blender headless, Three.js GLB 로딩, Rapier 충돌체, 라이선스 차이, 오픈소스에서 발견한 오류와 수정.

자체 OSS 후보 `mesh-ready-check`: AI 생성 3D 메시의 게임 사용 가능 여부 자동 검사 도구. 기능: 기본 통계, non-manifold, 분리 조각, 노멀, UV·텍스처, 원점·크기·바닥, 폴리곤 예산, JSON 보고서, CI 실패 기준.

## 23. GitHub Actions

검사: Ruff, pytest, TS 타입 검사, 프론트 빌드, 작업 상태 스키마, GLB 메타데이터, 샘플 메시 품질, API 응답 스키마.

CI에서 대형 모델 다운로드 금지. 모델 호출은 mock adapter. 작은 테스트용 OBJ/GLB만 사용. 기본 권한 `permissions: contents: read`.

## 24. 완료 조건

1. 그림 업로드 2. 입력 검증 3. SAM 2 마스크 생성 4. 마스크 확인·수정 5. 전처리 이미지 생성 6. TripoSR 실행 7. 메시 자동 검사 8. 자동 보정 9. GLB 변환 10. 웹 뷰어 확인 11. 가상 공간 배치 12. 이동·회전 13. 보정 전후 보고서 14. 동일 평가 이미지로 개선 전후 비교

## 25. 개발 원칙

- 단일 이미지 3D 생성을 정밀 복원이라고 표현하지 않는다.
- 모델 생성 성공과 게임 자산 사용 가능을 구분한다.
- 입력·분할·생성·보정·출력을 독립 모듈로 만든다.
- 모델 호출은 adapter로 분리한다.
- 생성 파일을 무조건 성공 처리하지 않는다.
- GPU 작업 실패 시 원인과 단계를 기록한다.
- 원본 메시와 보정 메시를 모두 보존한다.
- 라이선스가 다른 모델을 동일하게 취급하지 않는다.
- 사용자 이미지와 생성물을 공개 저장소에 커밋하지 않는다.
- `.env`, 모델 가중치, 사용자 이미지, 대형 생성 파일을 `.gitignore`에 추가한다.
- 테스트 없이 완료 처리하지 않는다.
- 결정사항은 `docs/decision-log.md`에 기록한다.
- AI 실험은 `docs/experiments.md`에 기록한다.
