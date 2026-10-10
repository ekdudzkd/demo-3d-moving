from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

SCHEMA_VERSION = "1.0"


class Severity(str, Enum):
    INFO = "info"
    WARN = "warn"
    ERROR = "error"


@dataclass
class Check:
    code: str
    severity: Severity
    message: str
    value: Any = None

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "severity": self.severity.value,
            "message": self.message,
            "value": self.value,
        }


@dataclass
class Report:
    vertex_count: int = 0
    face_count: int = 0
    connected_components: int = 0
    small_components: int = 0
    largest_component_ratio: float = 0.0
    open_boundary_edges: int = 0
    non_manifold_edges: int = 0
    duplicate_vertices: int = 0
    degenerate_faces: int = 0
    long_edges: int = 0
    winding_consistent: bool = True
    inverted_normals: bool = False
    has_uv: bool = False
    has_texture: bool = False
    has_vertex_colors: bool = False
    bounds: list[list[float]] = field(default_factory=lambda: [[0.0] * 3, [0.0] * 3])
    extents: list[float] = field(default_factory=lambda: [0.0] * 3)
    centered: bool = False
    grounded: bool = False
    below_floor: bool = False
    checks: list[Check] = field(default_factory=list)
    thresholds: dict = field(default_factory=dict)

    def add(self, code: str, severity: Severity, message: str, value: Any = None) -> None:
        self.checks.append(Check(code, severity, message, value))

    @property
    def errors(self) -> list[Check]:
        return [c for c in self.checks if c.severity is Severity.ERROR]

    @property
    def warnings(self) -> list[Check]:
        return [c for c in self.checks if c.severity is Severity.WARN]

    @property
    def is_usable(self) -> bool:
        return not self.errors

    def to_dict(self) -> dict:
        return {
            "schema_version": SCHEMA_VERSION,
            "is_usable": self.is_usable,
            "vertex_count": self.vertex_count,
            "face_count": self.face_count,
            "connected_components": self.connected_components,
            "small_components": self.small_components,
            "largest_component_ratio": round(self.largest_component_ratio, 4),
            "open_boundary_edges": self.open_boundary_edges,
            "non_manifold_edges": self.non_manifold_edges,
            "duplicate_vertices": self.duplicate_vertices,
            "degenerate_faces": self.degenerate_faces,
            "long_edges": self.long_edges,
            "winding_consistent": self.winding_consistent,
            "inverted_normals": self.inverted_normals,
            "has_uv": self.has_uv,
            "has_texture": self.has_texture,
            "has_vertex_colors": self.has_vertex_colors,
            "bounds": self.bounds,
            "extents": self.extents,
            "centered": self.centered,
            "grounded": self.grounded,
            "below_floor": self.below_floor,
            "errors": [c.to_dict() for c in self.errors],
            "warnings": [c.to_dict() for c in self.warnings],
            "checks": [c.to_dict() for c in self.checks],
            "thresholds": self.thresholds,
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)
