"""3-6 스파이크: 그림 N장을 실제 서버·워커(SEGMENTER/GENERATOR 환경 변수)로 끝까지 돌려 표로 기록한다.

사용 (GPU venv):
  python scripts/make_spike_drawings.py
  MODEL_CACHE_DIR=~/.cache/d2w/models python scripts/spike_triposr.py [drawings_dir] [--run-id ID]

사람 수정 없이 업로드 때 자동 제안된 마스크 v1을 그대로 확정한다 (최악에 가까운 조건).
결과: data/spike/runs/<run_id>/{results.json, results.md}, 산출물은 같은 폴더의 data/ 아래.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def iou(a: np.ndarray, b: np.ndarray) -> float:
    union = (a | b).sum()
    return float((a & b).sum() / union) if union else 1.0


def wait_health(api: str, proc: subprocess.Popen, log: Path) -> None:
    for _ in range(300):
        if proc.poll() is not None:
            sys.exit(f"서버 종료됨:\n{log.read_text(errors='replace')[-2000:]}")
        try:
            if httpx.get(f"{api}/api/health", timeout=1).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.2)
    sys.exit("서버 기동 시간 초과")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("drawings", nargs="?", default=str(ROOT / "data/spike/drawings"))
    ap.add_argument("--run-id", default=datetime.now().strftime("spike-%Y%m%d-%H%M%S"))
    ap.add_argument("--port", type=int, default=8796)
    ap.add_argument("--options", default="{}", help='생성 옵션 JSON, 예: {"mc_resolution":256}')
    args = ap.parse_args()

    drawings = Path(args.drawings)
    manifest = json.loads((drawings / "drawings.json").read_text("utf-8"))
    run_dir = ROOT / "data/spike/runs" / args.run_id
    data_dir = run_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    env = {
        **os.environ,
        "DATA_DIR": str(data_dir),
        "SEGMENTER": os.environ.get("SEGMENTER", "sam2"),
        "GENERATOR": os.environ.get("GENERATOR", "triposr"),
        "MOCK_FAIL": "",
    }
    api = f"http://127.0.0.1:{args.port}"
    server_log = run_dir / "server.log"
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:create_app", "--factory",
         "--port", str(args.port)],  # fmt: skip
        cwd=ROOT / "backend",
        env=env,
        stdout=server_log.open("w"),
        stderr=subprocess.STDOUT,
    )
    rows = []
    try:
        wait_health(api, server, server_log)
        client = httpx.Client(base_url=api, timeout=300)
        jobs = []
        for item in manifest:
            path = drawings / item["file"]
            r = client.post("/api/projects", files={"file": (path.name, path.read_bytes())})
            row = {"id": item["id"], "description": item["description"]}
            if r.status_code != 201:
                row.update(stage="INPUT", status="REJECTED", detail=r.text[:200])
                rows.append(row)
                continue
            p = r.json()
            mask = p["masks"][-1]
            gt = Image.open(drawings / item["gt_mask"]).convert("L")
            if gt.size != (p["width"], p["height"]):
                gt = gt.resize((p["width"], p["height"]), Image.Resampling.NEAREST)
            pred = Image.open(data_dir / "projects" / p["id"] / "masks" / "mask_v1.png")
            row.update(
                project_id=p["id"],
                validation_warnings=[w["code"] for w in p["validation"].get("warnings", [])],
                mask_method=mask["method"],
                mask_coverage=mask["coverage"],
                mask_ms=mask["elapsed_ms"],
                mask_iou=round(iou(np.asarray(pred) >= 128, np.asarray(gt) >= 128), 3),
            )
            client.post(f"/api/projects/{p['id']}/mask/confirm", json={}).raise_for_status()
            job = client.post(
                f"/api/projects/{p['id']}/jobs", json={"options": json.loads(args.options)}
            )
            job.raise_for_status()
            jobs.append((row, job.json()["id"]))
            rows.append(row)

        print(f"job {len(jobs)}개 → 워커 실행", flush=True)
        started = time.perf_counter()
        subprocess.run(
            [sys.executable, "-m", "app.worker", "--once"],
            cwd=ROOT / "backend",
            env=env,
            stdout=(run_dir / "worker.log").open("w"),
            stderr=subprocess.STDOUT,
            check=True,
        )
        worker_s = time.perf_counter() - started

        for row, job_id in jobs:
            j = client.get(f"/api/jobs/{job_id}").json()
            row.update(job_id=job_id, status=j["status"], outcome=j["outcome"])
            row["stage_ms"] = {s["stage"]: s["elapsed_ms"] for s in j["stages"]}
            if j["error"]:
                row.update(error=j["error"]["code"], stage=j["error"]["stage"])
                continue
            report = client.get(j["files"]["report"]).json()
            q, t, m = report["quality"], report["timings"], report["model"]
            row.update(
                raw_faces=q["raw"]["face_count"],
                raw_components=q["raw"]["connected_components"],
                repaired_faces=q["repaired"]["face_count"],
                repaired_components=q["repaired"]["connected_components"],
                extents=q["repaired"]["extents"],
                generation_ms=t["generation_ms"],
                model_load_ms=t["model_load_ms"],
                peak_vram_mb=t["peak_vram_mb"],
                # 보정으로 해결된 유형은 * 표시
                failure_types=[
                    f["type"] + ("*" if f["fixed_by_repair"] else "")
                    for f in report.get("failure_types", [])
                ],
                warnings=m.get("warnings", []),
                collider=report["asset"]["collision_type"] if report.get("asset") else None,
            )
    finally:
        server.terminate()
        server.wait(10)

    summary = summarize(rows, worker_s if "worker_s" in dir() else None)
    out = {"run_id": args.run_id, "env": {k: env[k] for k in ("SEGMENTER", "GENERATOR")},
           "options": json.loads(args.options), "summary": summary, "rows": rows}  # fmt: skip
    (run_dir / "results.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), "utf-8")
    md = to_markdown(rows, summary)
    (run_dir / "results.md").write_text(md, "utf-8")
    print(md)
    print(f"\n결과: {run_dir}")


def summarize(rows: list[dict], worker_s: float | None) -> dict:
    n = len(rows)
    done = [r for r in rows if r.get("status") == "COMPLETED"]
    usable = [r for r in done if r.get("outcome") in ("USABLE", "USABLE_WITH_WARNINGS")]
    gen = sorted(r["generation_ms"] for r in done if r.get("generation_ms") is not None)
    ious = [r["mask_iou"] for r in rows if "mask_iou" in r]
    return {
        "images": n,
        "completed": len(done),
        "usable": len(usable),
        "usable_clean": sum(r.get("outcome") == "USABLE" for r in done),
        "mask_iou_mean": round(float(np.mean(ious)), 3) if ious else None,
        "mask_iou_ge_0_8": sum(i >= 0.8 for i in ious),
        "generation_ms_median": gen[len(gen) // 2] if gen else None,
        "generation_ms_max": gen[-1] if gen else None,
        "peak_vram_mb_max": max((r.get("peak_vram_mb") or 0) for r in rows) or None,
        "model_load_ms": next((r["model_load_ms"] for r in done if r.get("model_load_ms")), None),
        "worker_total_s": round(worker_s, 1) if worker_s else None,
    }


def to_markdown(rows: list[dict], s: dict) -> str:
    lines = [
        "| 그림 | 마스크 IoU | 상태 | 판정 | raw 면 / 조각 | 보정 면 / 조각 | 생성 ms | VRAM MiB | 실패 유형 |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        lines.append(
            f"| {r['id']} | {r.get('mask_iou', '-')} | {r.get('status', '-')}"
            f"{' ' + r['error'] if r.get('error') else ''} | {r.get('outcome') or '-'} "
            f"| {r.get('raw_faces', '-')} / {r.get('raw_components', '-')} "
            f"| {r.get('repaired_faces', '-')} / {r.get('repaired_components', '-')} "
            f"| {r.get('generation_ms', '-')} | {r.get('peak_vram_mb', '-')} "
            f"| {', '.join(r.get('failure_types', [])) or '-'} |"
        )
    lines += [
        "",
        f"- 완료 {s['completed']}/{s['images']}, 사용 가능 {s['usable']}/{s['images']} "
        f"(경고 없음 {s['usable_clean']})",
        f"- 마스크 IoU 평균 {s['mask_iou_mean']}, 0.8 이상 {s['mask_iou_ge_0_8']}장",
        f"- 생성 시간 중앙값 {s['generation_ms_median']}ms, 최대 {s['generation_ms_max']}ms, "
        f"모델 로드 {s['model_load_ms']}ms, 최대 VRAM {s['peak_vram_mb_max']}MiB, "
        f"워커 전체 {s['worker_total_s']}초",
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    main()
