import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stepIndex } from "../src/app/steps";
import { PANELS, PANEL_ORDER, panelCamera, viewSpan } from "../src/features/edit/basis";
import { finishedMessage, planMessage, versionLabel } from "../src/features/edit/messages";
import { api } from "../src/services/api";
import type { VersionOut } from "../src/types/domain";

const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

describe("패널 기준표 (D-026)", () => {
  it("백엔드 basis.json과 같은 값이다", () => {
    const backend = JSON.parse(readFileSync(resolve(process.cwd(), "../backend/app/edit/basis.json"), "utf-8"));
    expect(PANELS).toEqual(backend.panels);
    expect([...PANEL_ORDER].sort()).toEqual(Object.keys(backend.panels).sort());
  });

  it.each(Object.entries(PANELS))("%s 패널은 오른손 좌표계", (_, p) => {
    expect(cross(p.screen_right, p.screen_up).map((v) => v + 0)).toEqual(p.toward_viewer.map((v) => v + 0));
  });

  it("카메라는 관찰자 쪽에 서고 위쪽은 화면 위", () => {
    expect(panelCamera("left", [0, 0.5, 0], 4)).toEqual({ position: [-4, 0.5, 0], up: [0, 1, 0] });
    expect(panelCamera("top", [0, 0, 0], 2)).toEqual({ position: [0, 2, 0], up: [0, 0, -1] });
  });

  it("보이는 범위는 e0 기준으로 고정되고 넘칠 때만 넓어진다", () => {
    const e0: [number[], number[]] = [[-0.5, 0, -0.2], [0.5, 1, 0.2]];
    expect(viewSpan(e0, e0)).toBeCloseTo(1.5);
    expect(viewSpan(e0, [[-0.5, 0, -0.4], [0.5, 1, 0.4]])).toBeCloseTo(1.5); // 두께 2배여도 범위 그대로 → 커져 보임
    expect(viewSpan(e0, [[-1, 0, -1], [1, 2, 1]])).toBeCloseTo(2.2);
  });
});

describe("편집 메시지", () => {
  const v = (o: Partial<VersionOut>): VersionOut =>
    ({ version: 1, status: "ready", kind: "edit", ops: [], intent: {}, prev_state: 0, ...o }) as VersionOut;

  it("대기열·거절·실패·완료", () => {
    expect(planMessage({ queued: true, kind: "ops", version: 3, ops: [], notes: ["거꾸로면 '뒤집어줘'"] }).text).toContain("e3 적용 중");
    const refuse = planMessage({ queued: false, kind: "refuse", message: "부분 편집은 아직", reason_code: "part_edit", suggested_text: "전체를 길게" });
    expect(refuse.tone).toBe("warn");
    expect(refuse.suggested).toBe("전체를 길게");
    expect(finishedMessage(v({ status: "failed", error: { user_message: "GLB 변환에 실패했습니다." } })).tone).toBe("error");
    expect(finishedMessage(v({ qc: { warnings: ["flat_geometry"] } })).text).toContain("flat_geometry");
  });

  it("버전 설명", () => {
    expect(versionLabel(v({ kind: "base", intent: { label: "left" } }))).toContain("left");
    expect(versionLabel(v({ kind: "undo", intent: { undo_of: 2, to: 1 } }))).toBe("e2 되돌림 → e1 상태");
    expect(versionLabel(v({ intent: { text: "더 두껍게" } }))).toBe("더 두껍게");
  });

  it("편집 화면은 3D 결과 단계", () => {
    expect(stepIndex("/jobs/job_1/edit")).toBe(3);
  });
});

describe("편집 API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("202는 대기열, 200은 거절로 구분한다", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ kind: "ops", version: 1, ops: [], notes: [] }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ kind: "refuse", message: "아니요", reason_code: "part_edit" }), { status: 200 }));
    vi.stubGlobal("fetch", fn);
    const a = await api.edit("ast_1", "left", "더 두껍게");
    expect(a.queued).toBe(true);
    expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ panel: "left", text: "더 두껍게" });
    expect(fn.mock.calls[0][0]).toBe("/api/assets/ast_1/edits");
    const b = await api.edit("ast_1", "front", "귀만 길게");
    expect(b.queued).toBe(false);
  });

  it("되돌리기 409는 오류로 던진다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "nothing_to_undo", detail: "더 되돌릴 편집이 없어요." }), { status: 409 })));
    await expect(api.undo("ast_1")).rejects.toThrow("더 되돌릴 편집이 없어요.");
  });
});
