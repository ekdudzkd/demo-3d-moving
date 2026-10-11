/** 실패 유형 → 화면 이름과 사용자가 할 수 있는 해결 행동 (백엔드 app/report/failures.py와 같은 코드). */

export type FailureAction =
  /** 마스크 편집 화면으로 돌아가 포함점·제외점으로 고친다 */
  | "edit_mask"
  /** 같은 마스크로 옵션을 바꿔 다시 생성한다 */
  | "retry_bake"
  /** 자동 보정이 처리하거나, 사용자가 할 수 있는 일이 없다 */
  | "none";

interface FailureInfo {
  label: string;
  action: FailureAction;
}

export const FAILURE_INFO: Record<string, FailureInfo> = {
  BACKGROUND_LEAK: { label: "배경이 함께 잡힘", action: "edit_mask" },
  MISSING_PART: { label: "그림 일부가 3D에서 빠짐", action: "edit_mask" },
  COLLAPSED_BACK: { label: "뒷면이 납작함", action: "none" },
  FLOATING_COMPONENT: { label: "떠 있는 작은 조각", action: "none" },
  BROKEN_TEXTURE: { label: "색·텍스처 없음", action: "retry_bake" },
  NON_MANIFOLD: { label: "꼬인 면 구조", action: "none" },
  TOO_MANY_FACES: { label: "폴리곤이 너무 많음", action: "none" },
  WRONG_SCALE: { label: "크기가 맞지 않음", action: "none" },
  INVALID_ORIGIN: { label: "원점·바닥 위치 틀림", action: "none" },
  COLLISION_FAILURE: { label: "충돌체 생성 실패", action: "none" },
};

export function failureInfo(type: string): FailureInfo {
  return FAILURE_INFO[type] ?? { label: type, action: "none" };
}

/** 남아 있는 실패 중 사용자가 바로 할 수 있는 행동 (중복 제거, 화면 위쪽 안내용). */
export function pendingActions(failures: { type: string; fixed_by_repair: boolean }[]): FailureAction[] {
  const out: FailureAction[] = [];
  for (const f of failures) {
    if (f.fixed_by_repair) continue;
    const { action } = failureInfo(f.type);
    if (action !== "none" && !out.includes(action)) out.push(action);
  }
  return out;
}
