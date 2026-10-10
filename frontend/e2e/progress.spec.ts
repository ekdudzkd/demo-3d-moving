import { expect, test } from "@playwright/test";

import { SHOTS, startJob } from "./helpers";

test("생성 단계가 실제 순서대로 진행되고 완료된다", async ({ page }) => {
  await startJob(page);
  // 백엔드 MOCK_DELAY_MS로 생성 단계가 잠시 머문다
  await expect(page.locator('[data-stage="GENERATING"][data-state="running"]')).toBeVisible();
  await expect(page.locator('[data-stage="GENERATING"]')).toContainText(/\d+(\.\d)?(ms|s) 경과/);
  // 시간대 오류가 있으면 수 시간으로 표시된다
  const shown = await page.locator('[data-stage="GENERATING"]').innerText();
  expect(Number(shown.match(/([\d.]+)s 경과/)?.[1] ?? 0)).toBeLessThan(60);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/3-progress-running.png`, fullPage: true });

  await expect(page.getByTestId("job-status")).toHaveText("완료", { timeout: 60_000 });
  for (const stage of ["PREPROCESSING", "GENERATING", "VALIDATING", "REPAIRING", "EXPORTING"]) {
    await expect(page.locator(`[data-stage="${stage}"]`)).toHaveAttribute("data-state", "done");
  }
  await expect(page.getByText("생성 완료")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/3-progress-done.png`, fullPage: true });
  await expect(page.getByRole("link", { name: "3D 결과 보기 →" })).toBeVisible();
});

test("대기 중 취소", async ({ page, request }) => {
  // 워커가 다른 작업을 처리하는 동안 대기열에 있는 작업을 취소한다
  await startJob(page, "별");
  const first = page.url();
  await startJob(page, "자동차");
  await page.getByRole("button", { name: "취소" }).click();
  await expect(page.getByTestId("job-error")).toContainText("취소됨");
  await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
  // 첫 작업은 정상 완료
  const id = first.split("/").pop()!;
  await expect.poll(async () => (await (await request.get(`/api/jobs/${id}`)).json()).status, { timeout: 60_000 }).toBe("COMPLETED");
});
