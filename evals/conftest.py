import sys
from pathlib import Path

# `pytest evals`로 실행할 때 저장소 루트(evals 패키지)와 backend(app 패키지)를 import 경로에 넣는다
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))
