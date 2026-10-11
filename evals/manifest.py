"""평가셋 manifest(evals/manifest.csv) 읽기·검증.

이미지 원본은 저장소에 넣지 않는다 (D-010). 행마다 root로 위치를 정한다:
- repo: 저장소 루트 기준 (공개 CC0 샘플 assets/samples)
- eval_data: 환경 변수 EVAL_DATA_DIR 기준 (팀 드라이브의 실제 그림·사진, 비공개)
- synthetic: SYNTHETIC_DIR(기본 data/spike/drawings) 기준. scripts/make_spike_drawings.py가 만든다
"""

from __future__ import annotations

import csv
import hashlib
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = Path(__file__).resolve().parent / "manifest.csv"

COLUMNS = [
    "id",
    "group",
    "category",
    "difficulty",
    "root",
    "file",
    "gt_mask",
    "source",
    "consent",
    "license",
    "sha256",
    "notes",
]
GROUPS = {"A": "그림(정상)", "B": "사진", "C": "하드 케이스"}
DIFFICULTIES = {"easy", "normal", "hard"}
ROOTS = {"repo", "eval_data", "synthetic"}
SOURCES = {"team", "family", "team_photo", "synthetic"}
CONSENTS = {"signed", "not_required"}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


@dataclass
class Entry:
    id: str
    group: str
    category: str
    difficulty: str
    root: str
    file: str
    gt_mask: str
    source: str
    consent: str
    license: str
    sha256: str
    notes: str
    line: int = 0

    def path(self, roots: dict[str, Path | None]) -> Path | None:
        base = roots.get(self.root)
        return None if base is None else base / self.file

    def mask_path(self, roots: dict[str, Path | None]) -> Path | None:
        base = roots.get(self.root)
        return None if base is None or not self.gt_mask else base / self.gt_mask


@dataclass
class ValidationReport:
    entries: list[Entry] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)  # 파일 위치를 몰라 존재·체크섬을 못 본 행

    @property
    def ok(self) -> bool:
        return not self.errors


def default_roots() -> dict[str, Path | None]:
    eval_dir = os.environ.get("EVAL_DATA_DIR")
    return {
        "repo": ROOT,
        "eval_data": Path(eval_dir).expanduser() if eval_dir else None,
        "synthetic": Path(os.environ.get("SYNTHETIC_DIR", ROOT / "data/spike/drawings")),
    }


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load(path: Path = MANIFEST) -> list[Entry]:
    """검증 없이 읽는다. 열이 다르면 ValueError."""
    with path.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != COLUMNS:
            raise ValueError(f"열이 다릅니다: {reader.fieldnames} (기대: {COLUMNS})")
        return [
            Entry(**{k: (row[k] or "").strip() for k in COLUMNS}, line=i)
            for i, row in enumerate(reader, start=2)
        ]


def _safe_relative(value: str) -> bool:
    p = Path(value)
    return bool(value) and not p.is_absolute() and ".." not in p.parts and "\\" not in value


def validate(
    path: Path = MANIFEST,
    roots: dict[str, Path | None] | None = None,
    check_files: bool = True,
) -> ValidationReport:
    roots = default_roots() if roots is None else roots
    report = ValidationReport()
    try:
        entries = load(path)
    except (OSError, ValueError) as exc:
        report.errors.append(f"{path.name}: {exc}")
        return report
    report.entries = entries
    seen: dict[str, int] = {}

    for e in entries:
        where = f"{path.name}:{e.line} ({e.id or '?'})"

        def err(msg: str, where: str = where) -> None:
            report.errors.append(f"{where}: {msg}")

        if not ID_RE.match(e.id):
            err("id는 소문자·숫자·_- 2~64자")
        elif e.id in seen:
            err(f"id 중복 (줄 {seen[e.id]})")
        seen.setdefault(e.id, e.line)
        if e.group not in GROUPS:
            err(f"group은 {sorted(GROUPS)} 중 하나")
        if not e.category:
            err("category 비어 있음")
        if e.difficulty not in DIFFICULTIES:
            err(f"difficulty는 {sorted(DIFFICULTIES)} 중 하나")
        if e.root not in ROOTS:
            err(f"root는 {sorted(ROOTS)} 중 하나")
        if e.source not in SOURCES:
            err(f"source는 {sorted(SOURCES)} 중 하나")
        if e.consent not in CONSENTS:
            err(f"consent는 {sorted(CONSENTS)} 중 하나")
        # 가족이 그린 그림은 보호자 동의서가 있어야 한다 (proposal §9)
        if e.source == "family" and e.consent != "signed":
            err("family 그림은 consent=signed 필요")
        if e.source == "family" and e.root == "repo":
            err("family 그림은 저장소(repo)에 둘 수 없음 — eval_data 사용")
        if not e.license:
            err("license 비어 있음")
        if not _safe_relative(e.file) or Path(e.file).suffix.lower() not in IMAGE_SUFFIXES:
            err("file은 상대 경로 이미지(.png/.jpg/.jpeg/.webp), '..'·절대 경로 금지")
        if e.gt_mask and not _safe_relative(e.gt_mask):
            err("gt_mask는 상대 경로, '..'·절대 경로 금지")
        # 합성 그림은 다시 만들 때 PNG 압축이 달라질 수 있어 체크섬을 강제하지 않는다
        if e.source != "synthetic" and not SHA_RE.match(e.sha256):
            err("sha256은 소문자 16진수 64자 (synthetic 외 필수)")

        if not check_files or e.root not in ROOTS:
            continue
        img = e.path(roots)
        if img is None:
            report.skipped.append(f"{where}: {e.root} 위치 미설정 (EVAL_DATA_DIR)")
            continue
        if not img.is_file():
            err(f"파일 없음: {img}")
        elif e.sha256 and SHA_RE.match(e.sha256) and sha256_file(img) != e.sha256:
            err(f"sha256 불일치: {img}")
        mask = e.mask_path(roots)
        if mask is not None and not mask.is_file():
            err(f"gt_mask 없음: {mask}")
    return report
