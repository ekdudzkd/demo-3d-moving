import type { components } from "./api";

export type ProjectOut = components["schemas"]["ProjectOut"];
export type MaskOut = components["schemas"]["MaskOut"];
export type ValidationResult = components["schemas"]["ValidationResult"];
export type Issue = components["schemas"]["Issue"];
export type JobOut = components["schemas"]["JobOut"];
export type JobError = components["schemas"]["JobError"];
export type JobEventOut = components["schemas"]["JobEventOut"];
export type SegmentIn = components["schemas"]["SegmentIn"];
export type JobCreateIn = components["schemas"]["JobCreateIn"];
export type EditsOut = components["schemas"]["EditsOut"];
export type VersionOut = components["schemas"]["VersionOut"];
export type EditQueuedOut = components["schemas"]["EditQueuedOut"];
export type EditPlanOut = components["schemas"]["EditPlanOut"];

export type JobStatus =
  | "QUEUED"
  | "PREPROCESSING"
  | "GENERATING"
  | "VALIDATING"
  | "REPAIRING"
  | "EXPORTING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export const PIPELINE_STAGES = ["PREPROCESSING", "GENERATING", "VALIDATING", "REPAIRING", "EXPORTING"] as const;

export const TERMINAL: string[] = ["COMPLETED", "FAILED", "CANCELLED"];

/** SSE `stage` 이벤트 데이터 */
export interface StageEvent {
  seq: number;
  stage: string;
  kind: "status" | "enter" | "exit" | "log" | "error";
  message: string;
  elapsed_ms: number | null;
  at: string;
  status: JobStatus;
}

export interface Collider {
  type: "convex_hull" | "bounding_box";
  points: number[][] | null;
  box: { center: number[]; half_extents: number[] };
  sphere: { center: number[]; radius: number };
  reason: string;
}

/** GET /api/assets/{id} — project-brief §14 */
export interface Asset {
  asset_id: string;
  display_name: string;
  mesh_url: string;
  raw_mesh_url: string;
  scale: number;
  spawn_position: [number, number, number];
  collision_type: Collider["type"];
  collider: Collider;
  interaction_type: string;
  mass: number;
  bounds: [number[], number[]];
}

export interface Check {
  code: string;
  severity: "info" | "warn" | "error";
  message: string;
  value: unknown;
}

export interface InspectReport {
  is_usable: boolean;
  vertex_count: number;
  face_count: number;
  connected_components: number;
  small_components: number;
  open_boundary_edges: number;
  non_manifold_edges: number;
  duplicate_vertices: number;
  degenerate_faces: number;
  has_uv: boolean;
  has_texture: boolean;
  has_vertex_colors: boolean;
  extents: number[];
  centered: boolean;
  grounded: boolean;
  errors: Check[];
  warnings: Check[];
}

export interface FailureType {
  type: string;
  evidence: string[];
  fixed_by_repair: boolean;
  remedy: string;
}

export interface Report {
  schema_version: string;
  job_id: string;
  generated_at: string;
  outcome: "USABLE" | "USABLE_WITH_WARNINGS" | "NOT_USABLE";
  usable: boolean;
  disclaimer: string;
  model: {
    name: string;
    version: string;
    description?: string;
    code_license: string;
    weights_license: string;
    commercial_use: string;
    options: Record<string, unknown>;
    warnings: string[];
  };
  input: {
    mask: { version: number; method: string; coverage: number } | null;
    preprocess: { foreground_ratio_actual: number; brightness_adjusted: boolean };
  };
  timings: {
    stages: { stage: string; elapsed_ms: number }[];
    generation_ms: number;
    model_load_ms: number;
    peak_vram_mb: number | null;
  };
  quality: {
    raw: InspectReport;
    repaired: InspectReport;
    diff: { metric: string; before: unknown; after: unknown; improved: boolean | null }[];
  };
  repair_steps: { name: string; applied: boolean; rolled_back: boolean; reason: string; elapsed_ms: number }[];
  failure_types: FailureType[];
  /** 실패 분류 신호 (4-3 이후 보고서) */
  signals?: {
    silhouette?: { iou: number; recall: number; precision: number };
    mask_coverage?: number;
    mask_border_sides?: number;
  };
  asset: { asset_id: string; collision_type: string };
  downloads: Record<string, string>;
}
