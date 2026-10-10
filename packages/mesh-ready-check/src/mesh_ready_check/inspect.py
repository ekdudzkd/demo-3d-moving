"""메시 품질 검사. 좌표계는 glTF 기준 Y-up, 바닥은 y=0."""

from __future__ import annotations

import json
import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import trimesh

from .report import Report, Severity
from .thresholds import Thresholds


@dataclass
class VisualInfo:
    has_uv: bool = False
    has_texture: bool = False
    has_vertex_colors: bool = False

    def merge(self, other: VisualInfo) -> VisualInfo:
        return VisualInfo(
            self.has_uv or other.has_uv,
            self.has_texture or other.has_texture,
            self.has_vertex_colors or other.has_vertex_colors,
        )


def visual_info(mesh: trimesh.Trimesh) -> VisualInfo:
    visual = mesh.visual
    info = VisualInfo()
    if visual is None:
        return info
    if visual.kind == "texture":
        uv = getattr(visual, "uv", None)
        info.has_uv = uv is not None and len(uv) > 0
        material = getattr(visual, "material", None)
        image = None
        if material is not None:
            image = getattr(material, "baseColorTexture", None) or getattr(material, "image", None)
        info.has_texture = image is not None
    elif visual.kind in ("vertex", "face"):
        info.has_vertex_colors = True
    return info


def gltf_visual_info(path: Path) -> VisualInfo:
    """glTF 속성을 직접 읽는다. trimesh는 머티리얼이 있으면 COLOR_0을 버리기 때문."""
    suffix = path.suffix.lower()
    try:
        if suffix == ".glb":
            raw = path.read_bytes()
            (length,) = struct.unpack("<I", raw[12:16])
            gltf = json.loads(raw[20 : 20 + length])
        elif suffix == ".gltf":
            gltf = json.loads(path.read_text(encoding="utf-8"))
        else:
            return VisualInfo()
    except (OSError, ValueError, struct.error):
        return VisualInfo()
    info = VisualInfo()
    materials = gltf.get("materials", [])
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            attrs = prim.get("attributes", {})
            info.has_vertex_colors |= "COLOR_0" in attrs
            info.has_uv |= "TEXCOORD_0" in attrs
            mat = materials[prim["material"]] if "material" in prim else {}
            info.has_texture |= "baseColorTexture" in mat.get("pbrMetallicRoughness", {})
    return info


def load_mesh(path: str | Path) -> tuple[trimesh.Trimesh, VisualInfo]:
    """파일을 읽어 단일 메시로 합친다. 장면이면 노드 변환을 적용한 뒤 합친다."""
    path = Path(path)
    loaded = trimesh.load(str(path))
    if isinstance(loaded, trimesh.Trimesh):
        return loaded, visual_info(loaded).merge(gltf_visual_info(path))
    if not isinstance(loaded, trimesh.Scene):
        raise ValueError(f"메시가 아닌 파일입니다: {type(loaded).__name__}")

    meshes: list[trimesh.Trimesh] = []
    info = VisualInfo()
    for node in loaded.graph.nodes_geometry:
        transform, geom_name = loaded.graph[node]
        geom = loaded.geometry.get(geom_name)
        if not isinstance(geom, trimesh.Trimesh):
            continue
        info = info.merge(visual_info(geom))
        part = geom.copy()
        part.apply_transform(transform)
        meshes.append(part)
    info = info.merge(gltf_visual_info(path))
    if not meshes:
        return trimesh.Trimesh(), info
    return trimesh.util.concatenate(meshes), info


def inspect_path(path: str | Path, thresholds: Thresholds | None = None) -> Report:
    mesh, info = load_mesh(path)
    return inspect_mesh(mesh, thresholds, info)


def inspect_mesh(
    mesh: trimesh.Trimesh,
    thresholds: Thresholds | None = None,
    visuals: VisualInfo | None = None,
) -> Report:
    t = thresholds or Thresholds()
    r = Report(thresholds=t.to_dict())
    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    faces = np.asarray(mesh.faces, dtype=np.int64)
    r.vertex_count = len(vertices)
    r.face_count = len(faces)

    if r.face_count == 0 or r.vertex_count == 0:
        r.add("empty_mesh", Severity.ERROR, "면이 없는 빈 메시입니다.")
        return r
    if not np.isfinite(vertices).all():
        r.add("non_finite_vertices", Severity.ERROR, "NaN 또는 무한대 좌표가 있습니다.")
        return r

    _check_visuals(r, mesh, visuals)
    _check_bounds(r, vertices, t)
    if r.errors:
        return r

    # 위치가 같은 정점을 합친 사본으로 위상 검사 (UV 경계선이 열린 경계로 잡히지 않게)
    topo = trimesh.Trimesh(vertices=vertices.copy(), faces=faces.copy(), process=False)
    topo.merge_vertices()

    _check_duplicates(r, mesh)
    _check_components(r, topo, t)
    _check_edges(r, topo, t)
    _check_faces(r, topo)
    _check_normals(r, topo)
    _check_budget(r, t)
    return r


def _check_visuals(r: Report, mesh: trimesh.Trimesh, visuals: VisualInfo | None) -> None:
    info = visuals or visual_info(mesh)
    r.has_uv, r.has_texture, r.has_vertex_colors = (
        info.has_uv,
        info.has_texture,
        info.has_vertex_colors,
    )
    if not (info.has_texture or info.has_vertex_colors):
        r.add("no_color", Severity.WARN, "텍스처와 정점 색이 모두 없습니다.")
    elif info.has_uv and not info.has_texture:
        r.add("uv_without_texture", Severity.WARN, "UV는 있지만 텍스처 이미지가 없습니다.")


def _check_bounds(r: Report, vertices: np.ndarray, t: Thresholds) -> None:
    lo, hi = vertices.min(axis=0), vertices.max(axis=0)
    extents = hi - lo
    r.bounds = [lo.round(6).tolist(), hi.round(6).tolist()]
    r.extents = extents.round(6).tolist()
    size = float(extents.max())
    if size <= 0:
        r.add("degenerate_bounds", Severity.ERROR, "모든 정점이 한 점에 모여 있습니다.")
        return

    flat = float(extents.min()) / size
    if flat < t.flat_ratio:
        r.add(
            "flat_geometry",
            Severity.WARN,
            "종잇장처럼 납작한 형상입니다. 뒷면이 무너졌을 가능성이 있습니다.",
            round(flat, 4),
        )

    center = (lo + hi) / 2
    r.centered = bool(
        abs(center[0]) <= t.center_tolerance * size and abs(center[2]) <= t.center_tolerance * size
    )
    if not r.centered:
        r.add(
            "not_centered",
            Severity.WARN,
            "모델이 원점(x, z) 중앙에 있지 않습니다.",
            [round(float(center[0]), 4), round(float(center[2]), 4)],
        )

    tol = t.ground_tolerance * size
    r.grounded = bool(abs(lo[1]) <= tol)
    r.below_floor = bool(lo[1] < -tol)
    if not r.grounded:
        if r.below_floor:
            message = "바닥(y=0) 아래로 내려간 부분이 있습니다."
        else:
            message = "바닥에 닿아 있지 않습니다."
        r.add("not_grounded", Severity.WARN, message, round(float(lo[1]), 4))

    if t.target_size is not None:
        deviation = abs(size - t.target_size) / t.target_size
        if deviation > t.size_tolerance:
            r.add(
                "wrong_scale",
                Severity.WARN,
                f"최대 축 길이가 기대값 {t.target_size}와 다릅니다.",
                round(size, 4),
            )


def _check_duplicates(r: Report, mesh: trimesh.Trimesh) -> None:
    # 텍스처 메시는 UV 경계에서 위치만 같은 정점이 정상적으로 생기므로 UV까지 같아야 중복으로 본다
    data = np.asarray(mesh.vertices, dtype=np.float64)
    uv = getattr(mesh.visual, "uv", None) if mesh.visual is not None else None
    if uv is not None and len(uv) == len(data):
        data = np.hstack([data, np.asarray(uv, dtype=np.float64)])
    unique, _ = trimesh.grouping.unique_rows(data, digits=8)
    r.duplicate_vertices = int(len(data) - len(unique))
    if r.duplicate_vertices:
        r.add(
            "duplicate_vertices",
            Severity.WARN,
            "위치가 같은 중복 정점이 있습니다.",
            r.duplicate_vertices,
        )


def _check_components(r: Report, topo: trimesh.Trimesh, t: Thresholds) -> None:
    components = trimesh.graph.connected_components(
        topo.face_adjacency, nodes=np.arange(len(topo.faces)), min_len=1
    )
    sizes = np.array(sorted((len(c) for c in components), reverse=True))
    total = sizes.sum()
    r.connected_components = int(len(sizes))
    r.largest_component_ratio = float(sizes[0] / total)
    r.small_components = int((sizes < t.small_component_ratio * total).sum())

    if r.largest_component_ratio < t.min_largest_component_ratio:
        r.add(
            "fragmented",
            Severity.ERROR,
            "가장 큰 조각이 전체의 일부뿐입니다. "
            "배경이 메시로 생성됐거나 형상이 분리됐을 수 있습니다.",
            round(r.largest_component_ratio, 4),
        )
    if r.small_components:
        r.add(
            "small_components",
            Severity.WARN,
            "떠 있는 작은 분리 조각이 있습니다.",
            r.small_components,
        )


def _check_edges(r: Report, topo: trimesh.Trimesh, t: Thresholds) -> None:
    _, counts = np.unique(topo.edges_sorted, axis=0, return_counts=True)
    r.open_boundary_edges = int((counts == 1).sum())
    r.non_manifold_edges = int((counts > 2).sum())

    if r.open_boundary_edges:
        r.add(
            "open_boundary",
            Severity.WARN,
            "닫히지 않은 열린 경계(구멍)가 있습니다.",
            r.open_boundary_edges,
        )

    ratio = r.non_manifold_edges / r.face_count
    if ratio > t.non_manifold_error_ratio:
        r.add(
            "non_manifold",
            Severity.ERROR,
            "non-manifold edge가 너무 많습니다.",
            r.non_manifold_edges,
        )
    elif ratio > t.non_manifold_warn_ratio:
        r.add("non_manifold", Severity.WARN, "non-manifold edge가 있습니다.", r.non_manifold_edges)
    elif r.non_manifold_edges:
        r.add(
            "non_manifold",
            Severity.INFO,
            "non-manifold edge가 소수 있습니다.",
            r.non_manifold_edges,
        )

    lengths = topo.edges_unique_length
    median = float(np.median(lengths)) if len(lengths) else 0.0
    if median > 0:
        r.long_edges = int((lengths > median * t.long_edge_factor).sum())
        if r.long_edges:
            r.add("long_edges", Severity.WARN, "비정상적으로 긴 edge가 있습니다.", r.long_edges)


def _check_faces(r: Report, topo: trimesh.Trimesh) -> None:
    size = float(np.max(r.extents))
    eps = (size**2) * 1e-12
    r.degenerate_faces = int((topo.area_faces <= eps).sum())
    if r.degenerate_faces:
        r.add("degenerate_faces", Severity.WARN, "면적이 0인 면이 있습니다.", r.degenerate_faces)


def _check_normals(r: Report, topo: trimesh.Trimesh) -> None:
    r.winding_consistent = bool(topo.is_winding_consistent)
    if not r.winding_consistent:
        r.add("inconsistent_winding", Severity.WARN, "면 방향(winding)이 일관되지 않습니다.")

    # 면 노멀이 바깥(중심에서 멀어지는 방향)을 향하는지 면적 가중 평균으로 판단
    areas = topo.area_faces
    outward = topo.triangles_center - topo.bounds.mean(axis=0)
    score = float((np.einsum("ij,ij->i", topo.face_normals, outward) * areas).sum())
    scale = float(areas.sum() * np.max(r.extents))
    r.inverted_normals = bool(scale > 0 and score / scale < -0.01)
    if r.inverted_normals:
        r.add("inverted_normals", Severity.WARN, "노멀이 안쪽을 향하는 것으로 보입니다.")


def _check_budget(r: Report, t: Thresholds) -> None:
    if r.face_count > t.face_budget:
        r.add(
            "too_many_faces",
            Severity.WARN,
            f"면 수가 예산 {t.face_budget}을 넘습니다.",
            r.face_count,
        )
