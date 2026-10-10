import { expect, test } from "@playwright/test";

import { SHOTS, collectErrors, completedJob } from "./helpers";

test("보고서: 판정·보정 전후·실패 유형·다운로드", async ({ page, request }) => {
  const errors = collectErrors(page);
  const id = await completedJob(page, "사과");
  await page.getByRole("link", { name: "보고서" }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${id}/report$`));

  await expect(page.getByTestId("report-outcome")).toContainText("사용 가능");
  await expect(page.getByTestId("diff-table").locator("tr", { hasText: "grounded" })).toContainText("개선");
  const failures = page.getByTestId("failure-types");
  await expect(failures).toContainText("FLOATING_COMPONENT");
  await expect(failures).toContainText("INVALID_ORIGIN");
  await expect(failures.locator("li", { hasText: "FLOATING_COMPONENT" })).toContainText("자동 보정됨");
  await expect(page.getByTestId("repair-steps")).toContainText("작은 분리 조각 제거");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/6-report.png`, fullPage: true });

  // 다운로드 링크 5종이 실제 파일로 응답
  const links = page.locator("a[download]");
  await expect(links).toHaveCount(5);
  for (const href of await links.evaluateAll((as) => as.map((a) => a.getAttribute("href")!))) {
    const r = await request.get(href);
    expect(r.status(), href).toBe(200);
  }
  const glb = await request.get(await links.first().getAttribute("href") as string);
  expect((await glb.body()).subarray(0, 4).toString()).toBe("glTF");

  expect(errors).toEqual([]);
});
