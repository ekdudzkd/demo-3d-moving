"""테스트용 메시를 코드로 생성한다. 파일로 저장: python tests/meshes.py <out_dir>"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import trimesh


def place_on_floor(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    lo, hi = mesh.bounds
    center = (lo + hi) / 2
    mesh.apply_translation([-center[0], -lo[1], -center[2]])
    return mesh


def colored(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    mesh.visual = trimesh.visual.ColorVisuals(
        mesh, vertex_colors=np.tile([200, 120, 40, 255], (len(mesh.vertices), 1))
    )
    return mesh


def clean_box() -> trimesh.Trimesh:
    return colored(place_on_floor(trimesh.creation.box(extents=[1.0, 1.0, 1.0])))


def clean_sphere() -> trimesh.Trimesh:
    return colored(place_on_floor(trimesh.creation.icosphere(subdivisions=3, radius=0.5)))


def floating_piece() -> trimesh.Trimesh:
    body = trimesh.creation.icosphere(subdivisions=3, radius=0.5)
    chip = trimesh.creation.box(extents=[0.05, 0.05, 0.05])
    chip.apply_translation([0.0, 1.2, 0.0])
    return colored(place_on_floor(trimesh.util.concatenate([body, chip])))


def two_halves() -> trimesh.Trimesh:
    a = trimesh.creation.icosphere(subdivisions=2, radius=0.5)
    b = a.copy()
    b.apply_translation([1.5, 0.0, 0.0])
    return colored(place_on_floor(trimesh.util.concatenate([a, b])))


def inverted_sphere() -> trimesh.Trimesh:
    mesh = clean_sphere()
    mesh.invert()
    return mesh


def mixed_winding() -> trimesh.Trimesh:
    mesh = clean_sphere()
    faces = mesh.faces.copy()
    faces[:10] = faces[:10, ::-1]
    return colored(trimesh.Trimesh(mesh.vertices, faces, process=False))


def non_manifold() -> trimesh.Trimesh:
    """박스의 edge 하나에 지느러미 면을 여러 장 붙인다."""
    box = trimesh.creation.box(extents=[1.0, 1.0, 1.0])
    edge = box.edges_unique[0]
    a, b = box.vertices[edge]
    vertices = [box.vertices]
    faces = [box.faces]
    for i in range(3):
        tip = (a + b) / 2 + np.array([0.0, 2.0 + i, 0.5 * i])
        idx = len(np.vstack(vertices))
        vertices.append(np.array([tip]))
        faces.append(np.array([[edge[0], edge[1], idx]]))
    mesh = trimesh.Trimesh(np.vstack(vertices), np.vstack(faces), process=False)
    return colored(place_on_floor(mesh))


def paper_sheet() -> trimesh.Trimesh:
    return colored(place_on_floor(trimesh.creation.box(extents=[1.0, 1.0, 0.005])))


def below_floor() -> trimesh.Trimesh:
    return colored(trimesh.creation.icosphere(subdivisions=3, radius=0.5))


def off_center() -> trimesh.Trimesh:
    mesh = clean_box()
    mesh.apply_translation([2.0, 0.0, 0.0])
    return mesh


def duplicated_vertices() -> trimesh.Trimesh:
    box = trimesh.creation.box(extents=[1.0, 1.0, 1.0])
    tris = box.triangles.reshape(-1, 3)
    faces = np.arange(len(tris)).reshape(-1, 3)
    return colored(place_on_floor(trimesh.Trimesh(tris, faces, process=False)))


def high_poly() -> trimesh.Trimesh:
    return colored(place_on_floor(trimesh.creation.icosphere(subdivisions=4, radius=0.5)))


def uncolored_box() -> trimesh.Trimesh:
    return place_on_floor(trimesh.creation.box(extents=[1.0, 1.0, 1.0]))


ALL = {
    "clean_box": clean_box,
    "clean_sphere": clean_sphere,
    "floating_piece": floating_piece,
    "two_halves": two_halves,
    "inverted_sphere": inverted_sphere,
    "mixed_winding": mixed_winding,
    "non_manifold": non_manifold,
    "paper_sheet": paper_sheet,
    "below_floor": below_floor,
    "off_center": off_center,
    "duplicated_vertices": duplicated_vertices,
    "high_poly": high_poly,
    "uncolored_box": uncolored_box,
}


if __name__ == "__main__":
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for name, make in ALL.items():
        make().export(out / f"{name}.glb")
        print(out / f"{name}.glb")
