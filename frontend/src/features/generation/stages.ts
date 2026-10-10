import { PIPELINE_STAGES, type StageEvent } from "../../types/domain";

export const STAGE_LABELS: Record<string, string> = {
  QUEUED: "대기",
  PREPROCESSING: "이미지 정규화",
  GENERATING: "3D 생성",
  VALIDATING: "메시 검사",
  REPAIRING: "자동 보정",
  EXPORTING: "GLB·충돌체 변환",
  COMPLETED: "완료",
  FAILED: "실패",
  CANCELLED: "취소",
};

export type StageState = "pending" | "running" | "done" | "failed" | "skipped";

export interface StageView {
  stage: string;
  state: StageState;
  elapsedMs: number | null;
  startedAt: string | null;
}

type EventLike = Pick<StageEvent, "stage" | "elapsed_ms" | "at"> & { kind: string };

/** 실제 이벤트만으로 단계 상태를 만든다. 퍼센트 진행률은 만들지 않는다 (D-007). */
export function deriveStages(events: EventLike[], status: string): StageView[] {
  const views: StageView[] = PIPELINE_STAGES.map((stage) => ({ stage, state: "pending", elapsedMs: null, startedAt: null }));
  const byStage = new Map(views.map((v) => [v.stage, v]));
  for (const e of events) {
    const v = byStage.get(e.stage);
    if (!v) continue;
    if (e.kind === "enter") {
      v.state = "running";
      v.startedAt = e.at;
    } else if (e.kind === "exit") {
      v.state = "done";
      v.elapsedMs = e.elapsed_ms;
    } else if (e.kind === "error") {
      v.state = "failed";
    }
  }
  if (status === "FAILED" || status === "CANCELLED") {
    for (const v of views) if (v.state === "pending" || v.state === "running") v.state = v.state === "running" ? "failed" : "skipped";
  }
  return views;
}

export function formatMs(ms: number | null): string {
  if (ms == null) return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
