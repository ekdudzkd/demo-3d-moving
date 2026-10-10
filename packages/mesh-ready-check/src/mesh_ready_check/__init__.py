"""AI가 생성한 3D 메시의 게임·웹 자산 사용 가능 여부 검사."""

from .inspect import VisualInfo, inspect_mesh, inspect_path, load_mesh
from .report import SCHEMA_VERSION, Check, Report, Severity
from .thresholds import Thresholds

__version__ = "0.1.0"

__all__ = [
    "SCHEMA_VERSION",
    "Check",
    "Report",
    "Severity",
    "Thresholds",
    "VisualInfo",
    "inspect_mesh",
    "inspect_path",
    "load_mesh",
]
