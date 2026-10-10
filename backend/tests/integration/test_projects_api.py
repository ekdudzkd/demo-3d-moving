from pathlib import Path

from PIL import Image

import images

SAMPLES = Path(__file__).parents[3] / "assets" / "samples"


def upload(client, data: bytes, name="a.png"):
    return client.post("/api/projects", files={"file": (name, data, "image/png")})


def test_upload_sample_validated(client, ctx):
    r = upload(client, (SAMPLES / "apple.png").read_bytes())
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "VALIDATED"
    assert body["validation"]["is_valid"]
    assert body["validation"]["object_count"] == 1
    assert ctx.storage.original(body["id"]).exists()

    got = client.get(f"/api/projects/{body['id']}")
    assert got.status_code == 200
    assert got.json()["id"] == body["id"]
    assert client.get(body["original_url"]).status_code == 200


def test_tiny_image_rejected_and_not_stored(client, ctx):
    r = upload(client, images.png_bytes(Image.new("RGB", (4, 4))))
    assert r.status_code == 422
    assert r.json()["status"] == "REJECTED"
    assert list(ctx.storage.projects.iterdir()) == []


def test_unknown_project_404(client):
    assert client.get("/api/projects/prj_nope").status_code == 404
