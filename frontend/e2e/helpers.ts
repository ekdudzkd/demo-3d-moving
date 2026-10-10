import { expect, type Page } from "@playwright/test";

export const SHOTS = process.env.E2E_SHOTS_DIR;

/** 샘플 업로드 → 자동 마스크로 생성 시작 → 작업 화면 */
export async function startJob(page: Page, sample = "사과") {
  await page.goto("/");
  await page.getByRole("button", { name: sample }).click();
  await page.getByRole("button", { name: "객체 선택으로 →" }).click();
  await page.getByRole("button", { name: "이 마스크로 3D 생성 →" }).click();
  await expect(page).toHaveURL(/\/jobs\/job_[a-f0-9]+$/);
  return page.url().split("/").pop()!;
}

/** 생성 완료까지 기다린 뒤 작업 id 반환 */
export async function completedJob(page: Page, sample = "사과") {
  const id = await startJob(page, sample);
  await expect(page.getByTestId("job-status")).toHaveText("완료", { timeout: 60_000 });
  return id;
}

/** 페이지 오류 수집 (WebGL 경고 등 콘솔 경고는 제외) */
export function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return errors;
}
