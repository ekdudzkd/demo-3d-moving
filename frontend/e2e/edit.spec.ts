import { expect, test, type Page } from "@playwright/test";

import { SHOTS, collectErrors, completedJob } from "./helpers";

interface Version {
  version: number;
  status: string;
  kind: string;
  ops: unknown[];
  bounds: number[][];
}
interface Edits {
  active_version: number;
  can_undo: boolean;
  in_progress: number | null;
  versions: Version[];
}

async function edits(page: Page, assetId: string): Promise<Edits> {
  const r = await page.request.get(`/api/assets/${assetId}/edits`);
  expect(r.ok()).toBeTruthy();
  return r.json();
}

/** 처리 중인 편집 버전이 없을 때까지 */
async function settle(page: Page, assetId: string) {
  await expect.poll(async () => (await edits(page, assetId)).in_progress, { timeout: 60_000 }).toBeNull();
}

test("6방향 편집: 세워줘 → 더 두껍게 → 되돌리기", async ({ page }) => {
  const errors = collectErrors(page);
  const jobId = await completedJob(page, "자동차");
  const job = await (await page.request.get(`/api/jobs/${jobId}`)).json();
  const assetId: string = job.asset_id;

  await page.goto(`/jobs/${jobId}/result`);
  await page.getByRole("link", { name: "6방향 보기·편집" }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${jobId}/edit$`));
  await expect(page.locator("canvas")).toHaveCount(6);
  await expect(page.getByTestId("active-version")).toHaveText("현재 e0");
  await expect(page.getByTestId("panel-front")).toHaveAttribute("aria-checked", "true");

  // 패널 선택 → 입력창 안내가 그 패널 기준으로 바뀜
  await page.getByTestId("panel-top").click();
  await expect(page.getByTestId("panel-top")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("panel-front").click();

  const e0 = (await edits(page, assetId)).versions[0];
  const chat = page.getByTestId("edit-chat");

  // 1) 세워줘: 이미 서 있으면 noop 안내, 아니면 새 버전 적용 — 어느 쪽이든 응답이 보여야 한다
  await page.getByRole("button", { name: "세워줘", exact: true }).click();
  await expect(chat).toContainText("[정면] 세워줘");
  await expect.poll(() => chat.locator("> div").count()).toBeGreaterThanOrEqual(2);
  await settle(page, assetId);
  const afterStand = await edits(page, assetId);
  const userEdits = afterStand.versions.length - 1;

  // 2) 더 두껍게: 새 편집 버전이 활성화되고, 범위(bounds) z가 커진다
  await page.getByRole("button", { name: "더 두껍게", exact: true }).click();
  const thick = userEdits + 1;
  await expect(chat).toContainText(`e${thick} 적용 완료`, { timeout: 60_000 });
  await expect(page.getByTestId("active-version")).toHaveText(`현재 e${thick}`);
  const afterThick = await edits(page, assetId);
  const tv = afterThick.versions.find((v) => v.version === thick)!;
  expect(tv.status).toBe("ready");
  expect(tv.kind).toBe("edit");
  const before = afterStand.versions.find((v) => v.version === afterStand.active_version)!;
  // 정면 패널의 "두껍게" = 깊이(z) 방향 확대
  expect(tv.bounds[1][2] - tv.bounds[0][2]).toBeGreaterThan((before.bounds[1][2] - before.bounds[0][2]) * 1.1);
  await page.waitForTimeout(1500); // GLB 로딩
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/7-edit-thick.png`, fullPage: true });

  // 3) 되돌리기를 사용자 편집 수만큼 → 활성 버전의 op가 e0과 같다
  for (let i = 1; i <= userEdits + 1; i++) {
    await page.getByRole("button", { name: "되돌리기", exact: true }).click();
    await expect(chat).toContainText(`e${thick + i} 적용 완료`, { timeout: 60_000 });
  }
  const final = await edits(page, assetId);
  const active = final.versions.find((v) => v.version === final.active_version)!;
  expect(active.kind).toBe("undo");
  expect(active.status).toBe("ready");
  expect(active.ops).toEqual(e0.ops);
  expect(final.can_undo).toBe(false);
  await expect(page.getByTestId("active-version")).toHaveText(`현재 e${final.active_version}`);
  await expect(page.getByRole("button", { name: "되돌리기", exact: true })).toBeDisabled();
  // append-only: 이전 버전은 목록에 그대로 남는다
  await expect(page.getByTestId("edit-versions").locator("li")).toHaveCount(final.versions.length);

  expect(errors.filter((e) => !e.includes("WebGL") && !e.includes("GPU stall"))).toEqual([]);
});
