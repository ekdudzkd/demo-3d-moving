"""TripoSR import에 필요한 외부 모듈 대체 (D-020).

- torchmcubes: CUDA 툴킷으로 소스 빌드해야 해서 설치가 자주 깨진다. scikit-image marching cubes로 대신한다.
  TripoSR은 marching cubes 결과만 쓰므로 같은 출력 형식(정점 x=마지막 축 순서, 면 인덱스)을 맞춘다.
- rembg: TripoSR utils가 import만 한다. 배경 제거는 우리 분할·전처리가 하므로(D-006) 쓰지 않는다.
"""

from __future__ import annotations

import sys
import types

import numpy as np


def _marching_cubes(volume, threshold: float):
    import torch
    from skimage.measure import marching_cubes

    arr = volume.detach().float().cpu().numpy()
    try:
        verts, faces, _, _ = marching_cubes(arr, level=float(threshold))
    except (ValueError, RuntimeError):  # 등위면이 없음 → 빈 메시
        return torch.zeros((0, 3)), torch.zeros((0, 3), dtype=torch.long)
    # skimage는 (축0, 축1, 축2), torchmcubes는 (축2, 축1, 축0) 순서. 면 방향도 torchmcubes와 맞춘다
    verts = np.ascontiguousarray(verts[:, ::-1])
    faces = np.ascontiguousarray(faces[:, ::-1])
    return torch.from_numpy(verts.copy()).float(), torch.from_numpy(faces.astype(np.int64))


def install() -> list[str]:
    """필요한 대체 모듈을 sys.modules에 등록하고 등록한 이름을 돌려준다."""
    installed = []
    try:
        import torchmcubes  # noqa: F401
    except ImportError:
        mod = types.ModuleType("torchmcubes")
        mod.marching_cubes = _marching_cubes
        sys.modules["torchmcubes"] = mod
        installed.append("torchmcubes")
    if "rembg" not in sys.modules:
        try:
            import rembg  # noqa: F401
        except ImportError:
            mod = types.ModuleType("rembg")

            def _unused(*_a, **_k):
                raise RuntimeError("rembg는 사용하지 않습니다. 배경 제거는 분할·전처리 단계가 합니다.")

            mod.remove = _unused
            mod.new_session = _unused
            sys.modules["rembg"] = mod
            installed.append("rembg")
    return installed
