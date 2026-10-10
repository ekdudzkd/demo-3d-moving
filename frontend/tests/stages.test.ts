import { describe, expect, it } from "vitest";

import { deriveStages, formatMs } from "../src/features/generation/stages";

const ev = (stage: string, kind: "enter" | "exit" | "error", elapsed_ms: number | null = null) => ({
  stage,
  kind,
  elapsed_ms,
  at: "2026-10-11T00:00:00Z",
});

describe("deriveStages", () => {
  it("대기 중이면 모든 단계가 pending", () => {
    expect(deriveStages([], "QUEUED").map((s) => s.state)).toEqual(["pending", "pending", "pending", "pending", "pending"]);
  });

  it("실제 이벤트대로 done / running", () => {
    const s = deriveStages([ev("PREPROCESSING", "enter"), ev("PREPROCESSING", "exit", 300), ev("GENERATING", "enter")], "GENERATING");
    expect(s[0]).toMatchObject({ state: "done", elapsedMs: 300 });
    expect(s[1].state).toBe("running");
    expect(s[2].state).toBe("pending");
  });

  it("실패하면 실패 단계와 건너뛴 단계를 구분", () => {
    const s = deriveStages(
      [ev("PREPROCESSING", "enter"), ev("PREPROCESSING", "exit", 10), ev("GENERATING", "enter"), ev("GENERATING", "error")],
      "FAILED",
    );
    expect(s.map((v) => v.state)).toEqual(["done", "failed", "skipped", "skipped", "skipped"]);
  });

  it("단계와 무관한 이벤트는 무시", () => {
    expect(deriveStages([ev("QUEUED", "enter")], "QUEUED")[0].state).toBe("pending");
  });
});

it("formatMs", () => {
  expect(formatMs(450)).toBe("450ms");
  expect(formatMs(1530)).toBe("1.5s");
  expect(formatMs(null)).toBe("");
});
