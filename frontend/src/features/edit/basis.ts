// 6방향 패널 기준 (D-026). 백엔드와 같은 파일 하나를 읽어 두 언어가 어긋나지 않게 한다.
import basis from "../../../../backend/app/edit/basis.json";

export type Vec3 = [number, number, number];
export type Panel = "front" | "back" | "left" | "right" | "top" | "bottom";
export interface PanelAxes {
  screen_right: Vec3;
  screen_up: Vec3;
  toward_viewer: Vec3;
}

export const PANELS = basis.panels as Record<Panel, PanelAxes>;
export const PANEL_ORDER: Panel[] = ["front", "back", "left", "right", "top", "bottom"];
export const STABLE_LABELS = basis.labels.stable as Panel[];
export const EXPERIMENTAL_LABELS = basis.labels.experimental as Panel[];

export const PANEL_NAMES: Record<Panel, string> = {
  front: "정면",
  back: "뒤",
  left: "왼쪽",
  right: "오른쪽",
  top: "위",
  bottom: "아래",
};

/** 라벨 선택지 설명 (정면에서 본 사람 기준 카메라 위치) */
export const LABEL_HINTS: Record<Panel, string> = {
  front: "물체를 앞에서 본 그림",
  back: "물체를 뒤에서 본 그림",
  left: "앞에서 볼 때 왼쪽 옆면",
  right: "앞에서 볼 때 오른쪽 옆면",
  top: "위에서 내려다본 그림 (실험 기능)",
  bottom: "아래에서 올려다본 그림 (실험 기능)",
};

/** 패널 카메라: 물체 중심에서 toward_viewer 쪽으로 distance만큼, 위쪽은 screen_up */
export function panelCamera(panel: Panel, center: Vec3, distance: number): { position: Vec3; up: Vec3 } {
  const { toward_viewer: t, screen_up: u } = PANELS[panel];
  return {
    position: [center[0] + t[0] * distance, center[1] + t[1] * distance, center[2] + t[2] * distance],
    up: [...u] as Vec3,
  };
}

export type Bounds = [number[], number[]];

function maxExtent([lo, hi]: Bounds): number {
  return Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
}

/**
 * 패널에 보이는 정사각 범위의 한 변 (E2: 버전과 무관하게 고정해야 크기 변화가 보인다).
 * e0 최대 extent의 1.5배, 활성 버전이 넘치면 1.1배 여유로 넓힌다.
 */
export function viewSpan(e0: Bounds, current: Bounds): number {
  const base = maxExtent(e0) * 1.5;
  const need = maxExtent(current) * 1.1;
  return Math.max(base, need, 1e-3);
}
