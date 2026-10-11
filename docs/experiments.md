# 실험 기록

각 실험은 아래 형식으로 추가한다. 한 번에 한 조건만 바꾼다.

```
## EXP-NNN 제목 (YYYY-MM-DD)
- 가설:
- 고정 조건: 평가셋 버전, 하드웨어, seed, 모델 버전
- 변경 조건:
- run_id: evals/generation-results/<run_id>
- 결과 표:
- 결론 / 다음 행동:
```

## 실험 목록

| ID | 제목 | 상태 |
|---|---|---|
| EXP-001 | TripoSR 그림 10장 스파이크 (3-6) | 완료 |
| EXP-002 | 분할 방법 비교: 없음 / GrabCut / SAM 2 / SAM 2+수정 | 예정 |
| EXP-003 | TripoSR vs Stable Fast 3D | 예정 |
| EXP-004 | 전처리 축별 비교 (전경 비율, 배경색, 해상도 등) | 예정 |

## EXP-001 TripoSR 그림 10장 스파이크 (2026-10-11)
- 가설: SAM 2 자동 마스크(사람 수정 없음) + TripoSR로 단순한 그림은 대부분 쓸 수 있는 자산이 된다. 어려운 그림(윤곽선만, 저대비, 가는 선, 물체 2개, 책상 사진)에서 어디가 깨지는지 찾는다.
- 고정 조건: `scripts/make_spike_drawings.py` 합성 그림 10장(CC0, 실제 아동 그림 아님, 정답 마스크 포함) · RTX 4050 Laptop 6GB(WSL2) · seed 0 · SAM 2.1 hiera-small · TripoSR 107cefd, mc 256, chunk 65536 · 면 예산 50k · 업로드 때 자동 제안된 마스크 v1을 그대로 확정
- 변경 조건: v1 = 3-5 시점 코드, v2 = 스파이크에서 찾은 문제 3개 수정 후 (D-024)
- run_id: `data/spike/runs/spike-v1`, `data/spike/runs/spike-v2` (gitignore, `python scripts/spike_triposr.py --run-id …`로 재현)
- 판정 열은 검사 결과 기준. `*`는 보정으로 해결된 실패 유형

### v1 (수정 전)
| 그림 | 마스크 IoU | 상태 | 판정 | raw 면 / 조각 | 보정 면 / 조각 | 생성 ms | VRAM MiB | 실패 유형 |
|---|---|---|---|---|---|---|---|---|
| apple | 0.946 | COMPLETED | USABLE_WITH_WARNINGS | 88752 / 1 | 50000 / 1 | 5501 | 2379 | INVALID_ORIGIN*, TOO_MANY_FACES* |
| car | 0.99 | COMPLETED | USABLE_WITH_WARNINGS | 87432 / 1 | 50000 / 4 | 5269 | 2379 | INVALID_ORIGIN*, FLOATING_COMPONENT, TOO_MANY_FACES* |
| star | 0.99 | COMPLETED | USABLE_WITH_WARNINGS | 52808 / 1 | 50000 / 1 | 5212 | 2379 | INVALID_ORIGIN*, TOO_MANY_FACES* |
| fish | 0.981 | COMPLETED | USABLE_WITH_WARNINGS | 53044 / 5 | 50000 / 1 | 5254 | 2379 | INVALID_ORIGIN*, FLOATING_COMPONENT*, TOO_MANY_FACES* |
| house | 0.996 | COMPLETED | USABLE_WITH_WARNINGS | 190480 / 1 | 50000 / 2 | 5308 | 2379 | INVALID_ORIGIN*, FLOATING_COMPONENT, TOO_MANY_FACES* |
| outline_cat | - | REJECTED | - | - / - | - / - | - | - | - |
| crayon_duck | 0.986 | COMPLETED | USABLE_WITH_WARNINGS | 89826 / 1 | 50000 / 4 | 5110 | 2379 | INVALID_ORIGIN*, FLOATING_COMPONENT, TOO_MANY_FACES* |
| stick_person | - | REJECTED | - | - / - | - / - | - | - | - |
| two_objects | 0.345 | COMPLETED | USABLE_WITH_WARNINGS | 135092 / 1 | 50000 / 2 | 5315 | 2379 | INVALID_ORIGIN*, FLOATING_COMPONENT, TOO_MANY_FACES* |
| desk_photo | 0.144 | COMPLETED | USABLE_WITH_WARNINGS | 123240 / 1 | 50000 / 2 | 5298 | 2379 | INVALID_ORIGIN*, FLOATING_COMPONENT, TOO_MANY_FACES* |

- 완료 8/10, 사용 가능 8/10 (경고 없음 0)
- 마스크 IoU 평균 0.797, 0.8 이상 6장
- 생성 시간 중앙값 5298ms, 최대 5501ms, 모델 로드 6738ms, 최대 VRAM 2379MiB, 워커 전체 91.7초

### v2 (수정 후)
| 그림 | 마스크 IoU | 상태 | 판정 | raw 면 / 조각 | 보정 면 / 조각 | 생성 ms | VRAM MiB | 실패 유형 |
|---|---|---|---|---|---|---|---|---|
| apple | 0.946 | COMPLETED | USABLE_WITH_WARNINGS | 88752 / 1 | 50000 / 1 | 5601 | 2379 | INVALID_ORIGIN*, TOO_MANY_FACES* |
| car | 0.99 | COMPLETED | USABLE | 87432 / 1 | 49994 / 1 | 5038 | 2379 | INVALID_ORIGIN*, TOO_MANY_FACES* |
| star | 0.99 | COMPLETED | USABLE_WITH_WARNINGS | 52808 / 1 | 50000 / 1 | 5260 | 2379 | INVALID_ORIGIN*, TOO_MANY_FACES* |
| fish | 0.981 | COMPLETED | USABLE_WITH_WARNINGS | 53044 / 5 | 50000 / 1 | 5138 | 2379 | INVALID_ORIGIN*, FLOATING_COMPONENT*, TOO_MANY_FACES* |
| house | 0.996 | COMPLETED | USABLE | 190480 / 1 | 49998 / 1 | 5243 | 2379 | INVALID_ORIGIN*, TOO_MANY_FACES* |
| outline_cat | 0.998 | COMPLETED | USABLE | 78070 / 2 | 49996 / 1 | 5238 | 2379 | INVALID_ORIGIN*, FLOATING_COMPONENT*, TOO_MANY_FACES* |
| crayon_duck | 0.986 | COMPLETED | USABLE | 89826 / 1 | 49994 / 1 | 5301 | 2379 | INVALID_ORIGIN*, TOO_MANY_FACES* |
| stick_person | 0.935 | COMPLETED | USABLE_WITH_WARNINGS | 11716 / 6 | 11424 / 1 | 5346 | 2379 | INVALID_ORIGIN*, FLOATING_COMPONENT* |
| two_objects | 0.345 | COMPLETED | USABLE | 135092 / 1 | 49998 / 1 | 5234 | 2379 | INVALID_ORIGIN*, TOO_MANY_FACES* |
| desk_photo | 0.943 | COMPLETED | USABLE | 85068 / 1 | 49994 / 1 | 5506 | 2379 | INVALID_ORIGIN*, TOO_MANY_FACES* |

- 완료 10/10, 사용 가능 10/10 (경고 없음 6)
- 마스크 IoU 평균 0.911, 0.8 이상 9장
- 생성 시간 중앙값 5260ms, 최대 5601ms, 모델 로드 6674ms, 최대 VRAM 2379MiB, 워커 전체 103.2초

- 결론
  - 수정 전 문제 3개: ① 윤곽선 고양이·막대 사람이 입력 검사에서 거부(잉크 픽셀 1.3~1.6%로 크기를 잼) ② 책상 위 종이 사진에서 종이 전체를 물체로 잡음(IoU 0.144, 기울어진 종이 bbox 모서리의 책상색 때문) ③ quadric 감소가 얇은 부분을 끊어 보정 후 조각이 늘어남(car 1→4, 5장에서 FLOATING_COMPONENT 미해결).
  - 수정 후 완료 10/10, 마스크 IoU 평균 0.797→0.911, 미해결 실패 유형 5장→0장.
  - 해와 구름(IoU 0.345)은 큰 물체 하나만 남기는 설계대로 동작. 둘 다 원하면 사용자가 포함점으로 추가해야 함.
  - "사용 가능"이 "보기 좋음"은 아님: 막대 사람은 두께 0.22로 납작하고 별·물고기도 두께 0.13~0.16. 모양 품질 지표(실루엣 IoU 등)는 4-2에서 추가.
  - 보정 후 `degenerate_faces` 경고가 4장에 남음(감소·크기 정규화 뒤 생긴 아주 작은 면). 4-3 실패 분류 때 함께 다룸.
  - 생성 5.0~5.6초, 모델 로드 6.7초, 최대 VRAM 2379MiB로 6GB GPU에서 여유. 10장 워커 전체 103초.
- 다음 행동: 실제 손그림으로 같은 스파이크 반복(평가셋 4-1), 분할 비교 EXP-002.
