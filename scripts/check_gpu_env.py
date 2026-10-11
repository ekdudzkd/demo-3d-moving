"""GPU 실행 환경 점검 (3-1 스모크). 가중치는 받지 않는다 — import와 CUDA만 확인.

사용: ~/.venvs/d2w-gpu/bin/python scripts/check_gpu_env.py [--triposr-dir DIR]
모두 통과하면 exit 0, 하나라도 실패하면 exit 1.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--triposr-dir",
        default=os.environ.get("TRIPOSR_REPO_DIR", str(Path.home() / ".cache/d2w/TripoSR")),
    )
    args = ap.parse_args()
    failed: list[str] = []

    def check(name: str, fn) -> None:
        try:
            msg = fn()
            print(f"✓ {name}: {msg}")
        except Exception as e:  # noqa: BLE001 — 점검 스크립트는 모든 실패를 보고한다
            print(f"✗ {name}: {type(e).__name__}: {e}")
            failed.append(name)

    def torch_cuda():
        import torch

        if not torch.cuda.is_available():
            raise RuntimeError(f"torch {torch.__version__} — cuda 사용 불가")
        free, total = torch.cuda.mem_get_info()
        x = torch.ones(1024, 1024, device="cuda")
        assert float((x @ x).sum()) == 1024.0**3
        return (
            f"torch {torch.__version__}, {torch.cuda.get_device_name(0)}, "
            f"VRAM free {free // 2**20}/{total // 2**20} MiB, matmul ok"
        )

    def sam2_import():
        from sam2.build_sam import build_sam2_hf  # noqa: F401
        from sam2.sam2_image_predictor import SAM2ImagePredictor  # noqa: F401

        return "build_sam2_hf, SAM2ImagePredictor"

    def triposr_import():
        from app.generation import triposr_shims

        shimmed = triposr_shims.install()
        repo = Path(args.triposr_dir).expanduser()
        if not (repo / "tsr").is_dir():
            raise FileNotFoundError(f"{repo}/tsr 없음")
        sys.path.insert(0, str(repo))
        from tsr.system import TSR  # noqa: F401
        from tsr.utils import resize_foreground  # noqa: F401

        return f"tsr.system.TSR ({repo}), 대체 모듈 {shimmed or '없음'}"

    def marching_cubes():
        import torch
        from torchmcubes import marching_cubes as mc

        n = 32
        g = torch.linspace(-1, 1, n)
        z, y, x = torch.meshgrid(g, g, g, indexing="ij")
        vol = 0.6 - torch.sqrt(x**2 + y**2 + z**2)
        verts, faces = mc(vol, 0.0)
        if len(faces) == 0:
            raise RuntimeError("구에서 면이 0개")
        return f"구 {len(verts)}정점 {len(faces)}면"

    check("torch CUDA", torch_cuda)
    check("SAM 2 import", sam2_import)
    check("TripoSR import", triposr_import)
    check("marching cubes", marching_cubes)
    print("통과" if not failed else f"실패: {', '.join(failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
