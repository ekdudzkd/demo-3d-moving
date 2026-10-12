import type { EditResult } from "../../services/api";
import type { VersionOut } from "../../types/domain";

export type Tone = "ok" | "warn" | "error" | "info";

export interface ChatMessage {
  role: "user" | "system";
  text: string;
  tone?: Tone;
  /** 거절 시 제안 문장: 누르면 입력칸에 채운다 */
  suggested?: string | null;
}

export const QUICK_PROMPTS = ["세워줘", "더 두껍게", "더 얇게", "시계방향으로 90도 돌려", "좌우 반전", "반대로"];

/** 편집 요청 응답 → 채팅 메시지 */
export function planMessage(r: EditResult): ChatMessage {
  if (r.queued) {
    const notes = r.notes?.length ? ` ${r.notes.join(" ")}` : "";
    return { role: "system", text: `e${r.version} 적용 중…${notes}`, tone: "info" };
  }
  const tone: Tone = r.kind === "refuse" ? "warn" : "info";
  return { role: "system", text: r.message, tone, suggested: r.suggested_text ?? null };
}

/** 워커가 끝낸 버전 → 채팅 메시지 */
export function finishedMessage(v: VersionOut): ChatMessage {
  if (v.status === "failed") {
    const why = (v.error?.user_message as string | undefined) ?? "편집을 적용하지 못했어요.";
    return { role: "system", text: `e${v.version} 실패: ${why} 이전 상태를 그대로 쓰고 있어요.`, tone: "error" };
  }
  const warnings = (v.qc?.warnings as string[] | undefined) ?? [];
  const extra = warnings.length ? ` (경고: ${warnings.join(", ")})` : "";
  return { role: "system", text: `e${v.version} 적용 완료${extra}`, tone: "ok" };
}

const KIND_LABEL: Record<string, string> = { base: "기본", edit: "편집", undo: "되돌리기", revert: "복귀" };

/** 버전 목록 한 줄 설명 */
export function versionLabel(v: VersionOut): string {
  const intent = v.intent as Record<string, unknown>;
  if (v.kind === "base") return `입력 그림 기준 (${String(intent.label ?? "front")})`;
  if (v.kind === "undo") return `e${intent.undo_of} 되돌림 → e${intent.to} 상태`;
  if (v.kind === "revert") return `e${intent.revert_to} 상태로 복귀`;
  return String(intent.text || (intent.screen_ops as unknown[] | undefined)?.length + "개 op");
}

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}
