# Draw2World AI

그림 한 장을 업로드하면 객체를 분리하고 3D 모델로 만든 뒤, 메시 품질을 검사·보정해서 작은 가상 공간에서 움직여볼 수 있게 하는 서비스.

```
이미지 입력 → 입력 검사 → 객체 분할(SAM 2) → 사용자 마스크 확인 → 정규화
→ 3D 생성(TripoSR) → 메시 검사 → 자동 보정 → GLB → 충돌체 → 웹 월드
```

> 한 장의 이미지를 바탕으로 AI가 추정한 3D 모델입니다. 보이지 않는 부분은 실제 모습과 다를 수 있습니다.

## 상태

MVP 개발 중. 진행 상황은 [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).

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

백엔드(1단계)·프론트엔드(2단계) 구현 후 채운다.

```bash
cp .env.example .env
```

## 기여 규칙

- 사용자 이미지, 생성물, 모델 가중치, `.env`는 커밋하지 않는다. CI가 `scripts/check_forbidden_files.sh`로 검사한다.
- 작업 절차는 `IMPLEMENTATION_PLAN.md` §0.

## 라이선스

코드: MIT ([LICENSE](LICENSE)). 외부 모델·가중치는 각자의 라이선스를 따른다 ([docs/licenses.md](docs/licenses.md)).
