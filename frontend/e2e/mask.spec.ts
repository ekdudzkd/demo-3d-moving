import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.E2E_SHOTS_DIR;

async function uploadSample(page: Page, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name }).click();
  await page.getByRole("button", { name: "객체 선택으로 →" }).click();
  await expect(page).toHaveURL(/\/mask$/);
}

test("마스크 확인·수정 후 생성 시작", async ({ page }) => {
  await uploadSample(page, "자동차");
  await expect(page.getByText(/^v1 · grabcut/)).toBeVisible();
  for (const label of ["원본", "선택된 객체", "제거될 배경", "마스크 경계"]) {
    await expect(page.getByRole("img", { name: label, exact: true })).toBeVisible();
  }

  // 포함점 하나 추가 → v2
  const stage = page.getByTestId("mask-stage");
  const box = (await stage.boundingBox())!;
  await stage.click({ position: { x: box.width * 0.5, y: box.height * 0.45 } });
  await expect(page.getByText(/^v2 · grabcut/)).toBeVisible();
  await expect(page.getByText("수정 1회", { exact: false })).toBeVisible();

  // 사각형 지정 → v3
  await page.getByRole("button", { name: "▭ 사각형" }).click();
  await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.88, box.y + box.height * 0.72, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText(/^v3 · grabcut/)).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-mask.png`, fullPage: true });

  // 초기화 → 자동 제안 v4
  await page.getByRole("button", { name: "⟲ 초기화" }).click();
  await expect(page.getByText(/^v4 · grabcut/)).toBeVisible();

  await page.getByRole("button", { name: "이 마스크로 3D 생성 →" }).click();
  await expect(page).toHaveURL(/\/jobs\/job_[a-f0-9]+$/);
});
