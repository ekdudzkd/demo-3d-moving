import json

import meshes
from mesh_ready_check.cli import main


def write(tmp_path, name):
    path = tmp_path / f"{name}.glb"
    meshes.ALL[name]().export(path)
    return path


def test_clean_box_exit_zero(tmp_path):
    assert main([str(write(tmp_path, "clean_box"))]) == 0


def test_warning_only_passes_by_default_and_fails_on_warn(tmp_path):
    path = write(tmp_path, "floating_piece")
    assert main([str(path)]) == 0
    assert main([str(path), "--fail-on", "warn"]) == 1


def test_error_fails_unless_never(tmp_path):
    path = write(tmp_path, "two_halves")
    assert main([str(path)]) == 1
    assert main([str(path), "--fail-on", "never"]) == 0


def test_budget_flag(tmp_path):
    path = write(tmp_path, "high_poly")
    assert main([str(path), "--budget", "1000", "--fail-on", "warn"]) == 1
    assert main([str(path), "--budget", "100000", "--fail-on", "warn"]) == 0


def test_json_output_file(tmp_path):
    out = tmp_path / "report.json"
    main([str(write(tmp_path, "clean_box")), "--json", str(out)])
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["is_usable"] is True
    assert data["schema_version"] == "1.0"


def test_json_stdout(tmp_path, capsys):
    main([str(write(tmp_path, "clean_box")), "--json", "-"])
    assert json.loads(capsys.readouterr().out)["face_count"] == 12


def test_missing_file_exit_two(tmp_path):
    assert main([str(tmp_path / "nope.glb")]) == 2
