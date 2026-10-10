"""glTF 규격에 맞는 GLB 쓰기.

trimesh 기본 출력은 머티리얼이 없어(→ glTF 기본값 metallic 1.0, 어둡게 보임) 노멀이 빠지고,
정점 색을 sRGB 그대로 쓴다(glTF COLOR_0은 linear). 웹 뷰어에서 색이 그림과 비슷하게 보이도록 보정한다.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np
import trimesh

MATERIAL = {
    "name": "draw2world",
    "pbrMetallicRoughness": {
        "baseColorFactor": [1, 1, 1, 1],
        "metallicFactor": 0.0,
        "roughnessFactor": 0.85,
    },
    "doubleSided": True,
}


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    c = c / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return np.clip(np.round(lin * 255), 0, 255).astype(np.uint8)


def write_glb(mesh: trimesh.Trimesh, path: Path) -> None:
    m = mesh.copy()
    if m.visual is not None and m.visual.kind == "vertex":
        colors = np.asarray(m.visual.vertex_colors).copy()
        colors[:, :3] = srgb_to_linear(colors[:, :3])
        m.visual = trimesh.visual.ColorVisuals(m, vertex_colors=colors)
    data = m.export(file_type="glb", include_normals=True)
    path.write_bytes(_ensure_material(data))


def _ensure_material(glb: bytes) -> bytes:
    """머티리얼이 없는 primitive에 비금속 기본 머티리얼을 넣는다."""
    magic, version, _ = struct.unpack("<4sII", glb[:12])
    json_len, json_type = struct.unpack("<I4s", glb[12:20])
    assert magic == b"glTF" and json_type == b"JSON"
    gltf = json.loads(glb[20 : 20 + json_len])
    rest = glb[20 + json_len :]

    missing = [
        p for mesh in gltf.get("meshes", []) for p in mesh["primitives"] if "material" not in p
    ]
    if not missing:
        return glb
    materials = gltf.setdefault("materials", [])
    materials.append(MATERIAL)
    for p in missing:
        p["material"] = len(materials) - 1

    chunk = json.dumps(gltf, separators=(",", ":")).encode()
    chunk += b" " * (-len(chunk) % 4)
    body = struct.pack("<I4s", len(chunk), b"JSON") + chunk + rest
    return struct.pack("<4sII", magic, version, 12 + len(body)) + body


def read_gltf_json(glb: bytes) -> dict:
    json_len = struct.unpack("<I", glb[12:16])[0]
    return json.loads(glb[20 : 20 + json_len])
