# TODO — 6방향 뷰 + 자연어 편집 (5단계)

설계: [`docs/designs/view-and-edit.md`](docs/designs/view-and-edit.md) · 진행 기준: [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) §4 5단계 · 결정: D-026~D-028

## 진행 현황

| ID | 내용 | 상태 |
|---|---|---|
| 5-1 | 편집 코어 (패널 기준표·라벨 회전·합성·stand_up·범위 검사) | ✅ 완료 |
| 5-2 | 버전 모델 + API (append-only 이력·undo 체인·실패 버전·asset SSE) | ✅ 완료 |
| 5-3 | EditPlanner (Mock 한국어 규칙 + Claude 구조화 출력 adapter) | ✅ 완료 |
| 5-4 | 프론트 6패널 편집 화면 | ✅ 완료 |
| 5-5 | pages 데모 적용 | ✅ 완료 |
| 5-6 | 데모 설계도 확인 단계 + 앞쪽(진행 방향) 지정 | 🟡 진행중 |

## 설계 리뷰에서 남은 정리 항목 (minor, 구현하며 반영)

- [ ] invert_last: 활성 버전이 undo/revert 복사본일 때 "직전 사용자 op" 기준 명시·테스트 (현재: 활성 op 리스트의 마지막 사용자 op)
- [ ] stand_up 가장 긴 축 동률(x≈z, 2%) 처리 문서화 (현재: x 우선)
- [ ] 편집 버전 보관 정책: 프로젝트 보관 기간(retention)과 함께 삭제됨을 문서화, asset당 버전 수 상한·실패 버전 GLB 정리 규칙
- [ ] 설계 문서 Next Steps의 옛 표기(`v{n}`, `clamp`, D-026 하나로 묶임) 정리
- [ ] 문제 정의의 라벨 범위(4개 + 실험 2개) 문구 통일

## 그 밖에

- [ ] ClaudePlanner 실제 API 호출 확인 (`EDIT_PLANNER=claude`, `pip install '.[llm]'`, API 키) — 5-3 Mock 문장 표로 정확도 측정
- [ ] 2차 의견의 증명 실험: 합성 물체 6방향 렌더 → 라벨별 생성 → 6방향 실루엣 IoU·종횡비 오차 비교 (4-4 비교표에 행 추가)
- [ ] v2 후보: 측면 패널에 윤곽 덧그리기(실루엣 기반 축별 scale), 부분 선택 변형, 다중 시점 입력
