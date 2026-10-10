# 메시 품질 기준

구현: `packages/mesh-ready-check` (schema_version `1.0`). 기본값: `thresholds.py`.

## 원칙

- 생성 성공(메시 파일 존재) ≠ 사용 가능(`is_usable`).
- `is_usable` = ERROR 등급 항목이 하나도 없음.
- watertight는 필수가 아니다 (웹 관찰·convex hull 충돌에는 불필요).
- 좌표계 glTF 기준 Y-up, 바닥 y=0.
- 위상 검사(조각·경계·non-manifold·winding)는 **위치가 같은 정점을 합친 사본**으로 한다. UV 경계선 때문에 갈라진 정점을 구멍으로 오판하지 않기 위해서.

## 등급

| 등급 | 의미 | 처리 |
|---|---|---|
| ERROR | 게임 자산으로 쓸 수 없음 | `NOT_USABLE`, 재생성 안내 |
| WARN | 쓸 수 있지만 문제 있음 | 자동 보정 시도, `USABLE_WITH_WARNINGS` |
| INFO | 통계·참고 | 보고서 표시 |

## 검사 항목

| code | 등급 | 조건 (기본값) | 근거 |
|---|---|---|---|
| `empty_mesh` | ERROR | 면 또는 정점 0 | 생성 실패 |
| `non_finite_vertices` | ERROR | NaN/Inf 좌표 | 렌더·물리 엔진 오류 |
| `degenerate_bounds` | ERROR | 최대 축 길이 0 | 크기 정규화 불가 |
| `fragmented` | ERROR | 최대 조각 면 비율 < 0.8 | 배경 누수 또는 형상 분리. 자동으로 어느 쪽이 본체인지 판단 불가 |
| `non_manifold` | ERROR / WARN / INFO | non-manifold edge 수 / 면 수 > 5% / > 1% / > 0 | 소수는 보정·렌더에 영향 적음 |
| `small_components` | WARN | 면 비율 2% 미만 조각 존재 | 떠 있는 부스러기. 자동 제거 대상 |
| `open_boundary` | WARN | 한 면에만 속한 edge 존재 | 구멍. 작은 것만 자동 보정 |
| `duplicate_vertices` | WARN | 위치(+UV)가 같은 정점 | 병합 대상. UV 경계 정점은 제외 |
| `degenerate_faces` | WARN | 면적 ≤ (최대 축)² × 1e-12 | 제거 대상 |
| `inconsistent_winding` | WARN | 인접 면 방향 불일치 | 노멀 재계산 대상 |
| `inverted_normals` | WARN | 면적 가중 (노멀 · 중심→면 벡터) 평균 < −1% | 뒤집힌 노멀 의심. 휴리스틱 |
| `long_edges` | WARN | edge > 중앙값 × 20 | 스파이크·찢어진 면 |
| `flat_geometry` | WARN | 최소 축 / 최대 축 < 0.02 | 종잇장 형상, 뒷면 붕괴(COLLAPSED_BACK) 후보 |
| `not_centered` | WARN | bbox 중심 x, z > 최대 축 × 5% | 원점 정렬 대상 |
| `not_grounded` | WARN | \|min y\| > 최대 축 × 1% | 바닥 정렬 대상. `below_floor`면 바닥 아래로 내려감 |
| `wrong_scale` | WARN | `target_size` 지정 시 ±10% 밖 | 크기 정규화 대상 |
| `too_many_faces` | WARN | 면 수 > 50,000 | 폴리곤 감소 대상 |
| `no_color` | WARN | 텍스처·정점 색 모두 없음 | BROKEN_TEXTURE 후보 |
| `uv_without_texture` | WARN | UV는 있고 이미지 없음 | 텍스처 경로 누락 |

## 보고서 필드

`schema_version, is_usable, vertex_count, face_count, connected_components, small_components, largest_component_ratio, open_boundary_edges, non_manifold_edges, duplicate_vertices, degenerate_faces, long_edges, winding_consistent, inverted_normals, has_uv, has_texture, has_vertex_colors, bounds, extents, centered, grounded, below_floor, errors[], warnings[], checks[], thresholds`

## 알려진 한계

- `inverted_normals`는 중심 기준 휴리스틱이라 크게 오목한 형상에서 오판할 수 있다.
- `fragmented` 기준(0.8)과 `non_manifold` 비율은 실제 TripoSR 출력으로 3-6에서 재조정한다.
