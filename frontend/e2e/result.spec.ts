import { expect, test } from "@playwright/test";

import { SHOTS, collectErrors, completedJob } from "./helpers";

test("3D 결과: 원본·보정본 뷰어, 보기 옵션, 품질 표", async ({ page }) => {
  const errors = collectErrors(page);
  const id = await completedJob(page, "별");
  await page.getByRole("link", { name: "3D 결과 보기 →" }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${id}/result$`));

  await expect(page.getByText("한 장의 이미지를 바탕으로 AI가 추정한 3D 모델입니다", { exact: false }).first()).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(2);
  const table = page.getByTestId("quality-table");
  await expect(table).toContainText("바닥에 닿음");
  await expect(table.locator("tr", { hasText: "바닥에 닿음" })).toContainText("아니오");
  await expect(table.locator("tr", { hasText: "분리된 조각" })).toContainText("2");

  await page.waitForTimeout(1500); // GLB 로딩
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-result.png`, fullPage: true });
  await page.getByRole("button", { name: "와이어프레임" }).click();
  await expect(page.getByRole("button", { name: "와이어프레임" })).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(500);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-result-wire.png` });
  await page.getByRole("button", { name: "원본·보정본 비교" }).click();
  await expect(page.locator("canvas")).toHaveCount(1);

  expect(errors.filter((e) => !e.includes("WebGL") && !e.includes("GPU stall"))).toEqual([]);
});
