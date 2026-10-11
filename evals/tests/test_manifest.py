"""4-1: manifest 스키마·검증."""

import csv
import hashlib
from pathlib import Path

from evals.manifest import COLUMNS, MANIFEST, validate
from evals.validate_manifest import main as cli

ROOT = Path(__file__).resolve().parents[2]


def roots(tmp_path, synthetic=None):
    return {"repo": ROOT, "eval_data": tmp_path / "eval", "synthetic": synthetic or tmp_path}


def write(tmp_path, rows):
    path = tmp_path / "manifest.csv"
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        for row in rows:
            w.writerow({k: "" for k in COLUMNS} | row)
    return path


def good_row(**over):
    sha = hashlib.sha256((ROOT / "assets/samples/apple.png").read_bytes()).hexdigest()
    row = {
        "id": "ok-1",
        "group": "A",
        "category": "사물",
        "difficulty": "easy",
        "root": "repo",
        "file": "assets/samples/apple.png",
        "source": "team",
        "consent": "not_required",
        "license": "CC0-1.0",
        "sha256": sha,
    }
    return row | over


def test_repo_manifest_public_rows_valid(tmp_path):
    # 합성 그림은 CI에 없으므로 형식만, 공개 샘플은 파일·체크섬까지
    report = validate(MANIFEST, roots(tmp_path), check_files=False)
    assert report.ok, report.errors
    public = [e for e in report.entries if e.root == "repo"]
    assert len(public) == 3
    path = write(tmp_path, [{k: getattr(e, k) for k in COLUMNS} for e in public])
    full = validate(path, roots(tmp_path))
    assert full.ok, full.errors


def test_good_row_passes(tmp_path):
    assert validate(write(tmp_path, [good_row()]), roots(tmp_path)).ok


def errors_for(tmp_path, **over):
    report = validate(write(tmp_path, [good_row(**over)]), roots(tmp_path))
    assert not report.ok
    return " ".join(report.errors)


def test_detects_bad_rows(tmp_path):
    assert "group" in errors_for(tmp_path, group="Z")
    assert "difficulty" in errors_for(tmp_path, difficulty="medium")
    assert "id" in errors_for(tmp_path, id="Bad ID!")
    assert "sha256 불일치" in errors_for(tmp_path, sha256="0" * 64)
    assert "sha256은" in errors_for(tmp_path, sha256="")
    assert "파일 없음" in errors_for(tmp_path, file="assets/samples/nope.png", sha256="0" * 64)
    assert "'..'" in errors_for(tmp_path, file="../secret.png")
    assert "license" in errors_for(tmp_path, license="")


def test_family_drawing_needs_consent_and_outside_repo(tmp_path):
    msg = errors_for(tmp_path, source="family", consent="not_required")
    assert "consent=signed" in msg and "저장소(repo)" in msg


def test_duplicate_id(tmp_path):
    report = validate(write(tmp_path, [good_row(), good_row()]), roots(tmp_path))
    assert any("중복" in e for e in report.errors)


def test_wrong_header(tmp_path):
    path = tmp_path / "m.csv"
    path.write_text("id,file\nx,y.png\n", encoding="utf-8")
    report = validate(path, roots(tmp_path))
    assert not report.ok and "열이 다릅니다" in report.errors[0]


def test_eval_data_rows_skipped_without_env(tmp_path):
    row = good_row(root="eval_data", file="kid1.png", source="family", consent="signed")
    report = validate(write(tmp_path, [row]), roots(tmp_path) | {"eval_data": None})
    assert report.ok and len(report.skipped) == 1


def test_cli_exit_codes(tmp_path):
    assert cli([str(write(tmp_path, [good_row()]))]) == 0
    assert cli([str(write(tmp_path, [good_row(group="Q")]))]) == 1
