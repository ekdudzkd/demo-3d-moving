# TODO — 6방향 뷰 + 자연어 편집 (5단계)

설계: [`docs/designs/view-and-edit.md`](docs/designs/view-and-edit.md) · 진행 기준: [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) §4 5단계 · 결정: D-026~D-028

## 진행 현황

| ID | 내용 | 상태 |
|---|---|---|
| 5-1 | 편집 코어 (패널 기준표·라벨 회전·합성·stand_up·범위 검사) | ✅ 완료 |
| 5-2 | 버전 모델 + API (append-only 이력·undo 체인·실패 버전·asset SSE) | ✅ 완료 |
| 5-3 | EditPlanner (Mock 한국어 규칙 + Claude 구조화 출력 adapter) | ✅ 완료 |
| 5-4 | 프론트 6패널 편집 화면 | 🟡 진행중 (코드·단위 테스트 완료, E2E·화면 확인 남음) |
| 5-5 | pages 데모 적용 | ⬜ 대기 |

## 5-4 남은 일 (완료 조건)

- [ ] `npm run build` 통과 확인 (Windows에서 esbuild postinstall이 allow-scripts로 막혀 있음 → `npm approve-scripts esbuild` 또는 WSL에서 빌드)
- [ ] E2E `e2e/edit.spec.ts` 작성·실행: 완료 job → `/jobs/:id/edit` → 캔버스 6개 → "세워줘"(응답 표시) → "더 두껍게" → e1 활성 → 되돌리기 → 활성 버전의 op가 e0과 같음, 페이지 오류 없음
- [ ] 실제 서버(백엔드+워커+프론트)로 화면 확인·스크린샷: 패널 선택 테두리, 점선 e0 상자, 두께 편집 시 패널에서 실제로 커져 보이는지(E2), left 라벨 업로드 시 e0 회전
- [ ] 마스크 화면의 "그림 방향" 선택이 job `options.view_label`로 들어가는지 확인
- [ ] IMPLEMENTATION_PLAN 5-4 ✅ 처리 + 작업 로그

## 5-5 pages 데모

- [ ] `pages/`에서 `backend/app/edit/basis.json`을 공유(배포 시 복사 단계 또는 빌드 스크립트)
- [ ] JS 편집 코어: 라벨 회전·화면 op → 월드 op·합성·바닥 맞춤·stand_up·범위 검사 (Python `compose.py`와 같은 규칙)
- [ ] JS Mock 플래너(한국어 규칙) — 5-3 테스트 문장 표를 JSON 픽스처로 빼서 Python·JS가 같은 표로 테스트
- [ ] 6패널 정사영 뷰 + 채팅 + 버전 목록을 데모 UI에 추가
- [ ] 교차 언어 테스트(같은 기대 행렬) + 브라우저 수동 확인

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
- [ ] `docs/status.md`에 5단계 요약 반영
