# 메시 품질 기준

> 초안. 검사 항목과 임계값의 기준은 `docs/proposal.md` §6. 1-2(mesh-ready-check) 구현 시 실제 키·기본값·근거를 여기에 확정한다.

## 원칙

- 생성 성공(메시 파일 존재) ≠ 사용 가능(`is_usable`).
- `is_usable` = ERROR 등급 항목이 하나도 없음.
- watertight는 필수가 아니다 (웹 관찰·convex hull 충돌에는 불필요).

## 등급

| 등급 | 의미 | 처리 |
|---|---|---|
| ERROR | 게임 자산으로 쓸 수 없음 | `NOT_USABLE`, 재생성 안내 |
| WARN | 쓸 수 있지만 문제 있음 | 자동 보정 시도, `USABLE_WITH_WARNINGS` |
| INFO | 통계 | 보고서 표시 |

## 검사 항목

1-2에서 확정.
