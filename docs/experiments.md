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
| EXP-002 | 분할 방법 비교: GrabCut vs SAM 2 (자동 마스크) | 완료 (없음·SAM2+수정은 예정) |
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

## EXP-002 분할 비교: GrabCut vs SAM 2 자동 마스크 (2026-10-11)
- 가설: SAM 2 자동 마스크가 GrabCut보다 배경을 덜 잡고, 그 차이가 사용 가능률까지 이어진다.
- 고정 조건: 합성 그림 10장(`evals/manifest.csv` synthetic, 정답 마스크) · RTX 4050 Laptop 6GB(WSL2) · TripoSR 107cefd mc 256 · 전처리 기본값 · 면 예산 50k · seed 0 · 사람 수정 없음
- 변경 조건: 분할기 grabcut → sam2 (SAM 2.1 hiera-small)
- run_id: `evals/generation-results/exp002-grabcut`, `exp002-sam2` (`python evals/benchmark.py --config evals/configs/gpu-<grabcut|sam2>.yaml`), 표는 `python evals/compare.py`로 생성
- 결과 표:

변경 조건: segmenter grabcut → sam2

| 지표 | 기준 `exp002-grabcut` | 비교 `exp002-sam2` | 변화 |
|---|---|---|---|
| 실행 수 | 10 | 10 | = |
| 입력 거부 | 0 | 0 | = |
| 생성 성공률 | 1.000 | 1.000 | = |
| 사용 가능률 | 0.900 | 1.000 | +0.100 ✅ |
| 월드 로딩률 | 1.000 | 1.000 | = |
| 마스크 IoU | 0.838 | 0.911 | +0.073 ✅ |
| 경계 F1 | 0.849 | 0.941 | +0.092 ✅ |
| 배경 포함률 | 0.090 | 0.007 | -0.083 ✅ |
| 실루엣 IoU | 0.918 | 0.929 | +0.011 ✅ |
| 보정 후 조각 수 | 1.200 | 1.000 | -0.200 ✅ |
| 보정 후 non-manifold | 0.000 | 0.000 | = |
| 생성 시간 중앙값(ms) | 5,168 | 5,006 | -162 ✅ |
| 전체 시간 중앙값(ms) | 9,138 | 9,454 | +316 ⚠️ |
| 최대 VRAM(MiB) | 2,379 | 2,706 | +327 ⚠️ |
| 미해결 BACKGROUND_LEAK | 2 | 0 | -2 ✅ |
| 미해결 MISSING_PART | 1 | 1 | = |

| 이미지 | seed | 사용 기준→비교 | 마스크 IoU 기준→비교 | 실루엣 IoU 기준→비교 |
|---|---|---|---|---|
| syn-apple | 0 | 예→예 | 0.945→0.946 | 0.974→0.981 |
| syn-car | 0 | 예→예 | 0.992→0.990 | 0.944→0.962 |
| syn-crayon-duck | 0 | 예→예 | 0.992→0.986 | 0.952→0.960 |
| syn-desk-photo | 0 | 예→예 | 0.157→0.943 ✅ | 0.970→0.970 |
| syn-fish | 0 | 예→예 | 0.993→0.981 | 0.962→0.971 |
| syn-house | 0 | 예→예 | 0.995→0.996 | 0.959→0.954 |
| syn-outline-cat | 0 | 예→예 | 0.995→0.998 | 0.970→0.969 |
| syn-star | 0 | 예→예 | 0.989→0.990 | 0.948→0.944 |
| syn-stick-person | 0 | 아니오→예 ✅ | 0.976→0.935 | 0.517→0.591 ✅ |
| syn-two-objects | 0 | 예→예 | 0.345→0.344 | 0.983→0.990 |

- 결론
  - SAM 2가 마스크 IoU +0.073, 경계 F1 +0.092, 배경 포함률 0.090→0.007. 차이는 거의 책상 사진(0.157→0.943) 한 장에서 나옴. 깨끗한 흰 종이 그림은 둘 다 0.98~0.99.
  - 사용 가능률 0.9→1.0: GrabCut의 막대 사람 마스크가 선 사이 종이까지 덮어 3D가 쓸 수 없게 나옴.
  - 실루엣 IoU는 "3D가 모델 입력과 닮았나"라서 분할이 틀려도 높게 나올 수 있음(책상 사진 GrabCut: 마스크 IoU 0.157인데 실루엣 IoU 0.970 — 종이 전체를 충실히 3D로 만든 것). 분할 품질은 마스크 IoU로 봐야 함.
  - 막대 사람은 두 경우 모두 MISSING_PART(실루엣 recall<0.85): 가는 선은 TripoSR이 일부만 살림. 분할이 아니라 생성 쪽 한계.
  - 해와 구름(0.344)은 두 방식 모두 큰 물체 하나만 남김(설계대로).
  - 비용: SAM 2는 최대 VRAM +327MiB, 전체 시간 +0.3초(첫 임베딩). 6GB GPU에서 문제없음.
  - TripoSR은 seed를 바꿔도 결과가 같아(gpu-baseline-v1: seed 0·1·2 동일) seed 반복은 의미 없음.
- 다음 행동: 실제 손그림 평가셋으로 같은 비교 반복, 가는 선 그림의 전처리(선 두껍게) 실험, "분할 없음"·"SAM 2+사람 수정" 축 추가.
