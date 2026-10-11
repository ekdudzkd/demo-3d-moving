import sys
from pathlib import Path

# `pytest evals`로 실행할 때 저장소 루트를 import 경로에 넣는다 (evals 패키지)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
