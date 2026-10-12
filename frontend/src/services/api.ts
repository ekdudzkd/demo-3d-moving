import type {
  Asset,
  EditPlanOut,
  EditQueuedOut,
  EditsOut,
  JobCreateIn,
  JobOut,
  MaskOut,
  ProjectOut,
  SegmentIn,
  ValidationResult,
  VersionOut,
} from "../types/domain";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: unknown = null,
  ) {
    super(message);
  }
}

function detailMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((d) => (d && typeof d === "object" && "msg" in d ? d.msg : String(d))).join(", ");
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, "서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인해 주세요.");
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new ApiError(res.status, detailMessage(body, `요청 실패 (${res.status})`), body);
  return body as T;
}

const post = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body ?? {}),
});

/** 편집 요청 결과: 202면 적용 대기열, 200이면 거절·되묻기·변화 없음 */
export type EditResult = ({ queued: true } & EditQueuedOut) | ({ queued: false } & EditPlanOut);

export type UploadResult = { ok: true; project: ProjectOut } | { ok: false; validation: ValidationResult };

export interface Health {
  status: string;
  version: string;
  generator: string;
  segmenter: string;
  retention_hours: number;
  max_upload_mb: number;
}

export interface ModelEntry {
  name: string;
  enabled: boolean;
  reason: string;
  info: { name: string; description?: string; min_vram_mb: number; commercial_use: string } | null;
  environment: { ok: boolean; device: string; gpu_name?: string | null; problems: string[] } | null;
}

export const api = {
  health: () => request<Health>("/api/health"),
  models: () => request<{ default: string; adapters: ModelEntry[] }>("/api/health/models"),

  async createProject(file: File): Promise<UploadResult> {
    const form = new FormData();
    form.append("file", file);
    try {
      return { ok: true, project: await request<ProjectOut>("/api/projects", { method: "POST", body: form }) };
    } catch (e) {
      const body = e instanceof ApiError ? e.body : null;
      if (e instanceof ApiError && e.status === 422 && body && typeof body === "object" && "validation" in body) {
        return { ok: false, validation: (body as { validation: ValidationResult }).validation };
      }
      throw e;
    }
  },
  getProject: (id: string) => request<ProjectOut>(`/api/projects/${id}`),
  segment: (id: string, body: SegmentIn) => request<MaskOut>(`/api/projects/${id}/segment`, post(body)),
  confirmMask: (id: string, version?: number) =>
    request<ProjectOut>(`/api/projects/${id}/mask/confirm`, post({ version: version ?? null })),
  createJob: (projectId: string, body: JobCreateIn = {}) =>
    request<JobOut>(`/api/projects/${projectId}/jobs`, post(body)),
  getJob: (id: string) => request<JobOut>(`/api/jobs/${id}`),
  cancelJob: (id: string) => request<JobOut>(`/api/jobs/${id}/cancel`, post()),
  retryJob: (id: string, body: JobCreateIn = {}) => request<JobOut>(`/api/jobs/${id}/retry`, post(body)),
  getAsset: (id: string) => request<Asset>(`/api/assets/${id}`),
  getJson: <T>(url: string) => request<T>(url),

  getEdits: (assetId: string) => request<EditsOut>(`/api/assets/${assetId}/edits`),
  async edit(assetId: string, panel: string, text: string): Promise<EditResult> {
    const body = await request<EditQueuedOut | EditPlanOut>(`/api/assets/${assetId}/edits`, post({ panel, text }));
    return body.kind === "ops" ? { queued: true, ...(body as EditQueuedOut) } : { queued: false, ...(body as EditPlanOut) };
  },
  undo: (assetId: string) => request<VersionOut>(`/api/assets/${assetId}/edits/undo`, post()),
  revert: (assetId: string, toVersion: number) =>
    request<VersionOut>(`/api/assets/${assetId}/edits/revert`, post({ to_version: toVersion })),
};
