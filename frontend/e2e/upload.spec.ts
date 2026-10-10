import { expect, test } from "@playwright/test";

const SHOTS = process.env.E2E_SHOTS_DIR;

test("샘플 업로드 → 검사 통과 → 객체 선택 이동", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "그림을 3D로" })).toBeVisible();
  await expect(page.getByText("24시간 뒤 서버에서 자동 삭제", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "사과" }).click();
  await expect(page.getByText("입력 검사 통과")).toBeVisible();
  await expect(page.getByText("객체 1개")).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-upload.png`, fullPage: true });

  await page.getByRole("button", { name: "객체 선택으로 →" }).click();
  await expect(page).toHaveURL(/\/projects\/prj_[a-f0-9]+\/mask/);
});

test("너무 작은 이미지는 거부 사유 표시", async ({ page }) => {
  await page.goto("/");
  // 1×1 PNG
  const tiny = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.getByTestId("file-input").setInputFiles({ name: "tiny.png", mimeType: "image/png", buffer: tiny });
  await expect(page.getByText("이 이미지는 사용할 수 없어요")).toBeVisible();
  await expect(page.getByText("짧은 변이 512px 이상", { exact: false })).toBeVisible();
});
