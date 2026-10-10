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
    assert body["status"] == "MASK_PROPOSED"
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


def test_upload_proposes_initial_mask(client):
    body = upload(client, (SAMPLES / "apple.png").read_bytes()).json()
    assert body["status"] == "MASK_PROPOSED"
    assert len(body["masks"]) == 1
    m = body["masks"][0]
    assert m["version"] == 1 and m["method"] == "grabcut"
    assert 0.05 < m["coverage"] < 0.9
    assert client.get(m["url"]).status_code == 200


def test_segment_and_confirm(client):
    pid = upload(client, (SAMPLES / "car.png").read_bytes()).json()["id"]
    r = client.post(
        f"/api/projects/{pid}/segment",
        json={"points": [{"x": 512, "y": 450, "label": 1}], "box": [150, 330, 890, 720]},
    )
    assert r.status_code == 201, r.text
    assert r.json()["version"] == 2
    assert 0.05 < r.json()["coverage"] < 0.9

    c = client.post(f"/api/projects/{pid}/mask/confirm", json={})
    assert c.status_code == 200
    assert c.json()["status"] == "MASK_CONFIRMED"
    assert c.json()["confirmed_mask_version"] == 2

    # 다시 분할하면 확정이 풀린다
    client.post(f"/api/projects/{pid}/segment", json={})
    assert client.get(f"/api/projects/{pid}").json()["confirmed_mask_version"] is None


def test_segment_rejects_out_of_bounds_point(client):
    pid = upload(client, (SAMPLES / "star.png").read_bytes()).json()["id"]
    r = client.post(f"/api/projects/{pid}/segment", json={"points": [{"x": 5000, "y": 1}]})
    assert r.status_code == 422


def test_confirm_unknown_version_404(client):
    pid = upload(client, (SAMPLES / "star.png").read_bytes()).json()["id"]
    assert client.post(f"/api/projects/{pid}/mask/confirm", json={"version": 9}).status_code == 404
