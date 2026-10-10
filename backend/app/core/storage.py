"""data/ 아래 파일 경로 규칙. 레이아웃은 IMPLEMENTATION_PLAN.md §2."""

from __future__ import annotations

from pathlib import Path


class Storage:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.projects = self.root / "projects"
        self.projects.mkdir(parents=True, exist_ok=True)

    def project_dir(self, project_id: str) -> Path:
        return self.projects / project_id

    def original(self, project_id: str) -> Path:
        return self.project_dir(project_id) / "original.png"

    def masks_dir(self, project_id: str) -> Path:
        return self.project_dir(project_id) / "masks"

    def mask(self, project_id: str, version: int) -> Path:
        return self.masks_dir(project_id) / f"mask_v{version}.png"

    def mask_prompts(self, project_id: str, version: int) -> Path:
        return self.masks_dir(project_id) / f"prompts_v{version}.json"

    def job_dir(self, project_id: str, job_id: str) -> Path:
        return self.project_dir(project_id) / "jobs" / job_id

    def url(self, path: Path) -> str:
        """data/ 하위 파일을 /api/files URL로 바꾼다."""
        rel = path.resolve().relative_to(self.root)
        return f"/api/files/{rel.as_posix()}"

    def resolve_public(self, rel: str) -> Path | None:
        """URL 경로를 실제 파일로. data/projects 밖이면 None (경로 탈출 방지)."""
        candidate = (self.root / rel).resolve()
        try:
            candidate.relative_to(self.projects)
        except ValueError:
            return None
        return candidate if candidate.is_file() else None
