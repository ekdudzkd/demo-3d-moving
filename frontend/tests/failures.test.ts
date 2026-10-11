import { describe, expect, it } from "vitest";

import { FAILURE_INFO, failureInfo, pendingActions } from "../src/features/quality-report/failures";

describe("실패 유형 안내", () => {
  it("백엔드 10개 유형 모두 한글 이름이 있다", () => {
    for (const t of [
      "BACKGROUND_LEAK", "MISSING_PART", "COLLAPSED_BACK", "FLOATING_COMPONENT", "BROKEN_TEXTURE",
      "NON_MANIFOLD", "TOO_MANY_FACES", "WRONG_SCALE", "INVALID_ORIGIN", "COLLISION_FAILURE",
    ]) {
      expect(FAILURE_INFO[t]?.label).toBeTruthy();
    }
    expect(failureInfo("UNKNOWN").label).toBe("UNKNOWN");
  });

  it("남아 있는 실패만 행동으로, 중복 없이", () => {
    expect(
      pendingActions([
        { type: "MISSING_PART", fixed_by_repair: false },
        { type: "BACKGROUND_LEAK", fixed_by_repair: false },
        { type: "BROKEN_TEXTURE", fixed_by_repair: false },
        { type: "INVALID_ORIGIN", fixed_by_repair: true },
      ]),
    ).toEqual(["edit_mask", "retry_bake"]);
    expect(pendingActions([{ type: "MISSING_PART", fixed_by_repair: true }])).toEqual([]);
    expect(pendingActions([{ type: "COLLAPSED_BACK", fixed_by_repair: false }])).toEqual([]);
  });
});
