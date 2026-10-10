# mesh-ready-check

AI가 생성한 3D 메시를 게임·웹 자산으로 쓸 수 있는지 자동 검사하는 도구. MIT.
의존성: trimesh, numpy, scipy (GPL 의존성 없음).

```bash
mesh-ready-check model.glb --budget 50000 --fail-on error --json report.json
```

| exit | 의미 |
|---|---|
| 0 | 통과 |
| 1 | `--fail-on` 기준 위반 (`error` 기본, `warn`, `never`) |
| 2 | 파일을 읽을 수 없음 |

```python
from mesh_ready_check import inspect_path, Thresholds

report = inspect_path("model.glb", Thresholds(face_budget=30_000))
report.is_usable, report.to_dict()
```

좌표계는 glTF 기준 Y-up, 바닥 y=0. 검사 항목과 기준은 저장소의 `docs/mesh-quality.md`.
