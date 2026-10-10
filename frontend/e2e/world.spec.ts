import { expect, test, type Page } from "@playwright/test";

import { SHOTS, collectErrors, completedJob } from "./helpers";

type Vec = [number, number, number];
const pos = (page: Page) => page.evaluate(() => window.__d2wWorld!.position()) as Promise<Vec>;
const yaw = (page: Page) => page.evaluate(() => window.__d2wWorld!.yaw()) as Promise<number>;

async function settle(page: Page) {
  // 떨어져서 바닥에 닿을 때까지
  await expect.poll(async () => Math.abs((await pos(page))[1]), { timeout: 15_000 }).toBeLessThan(0.05);
}

async function hold(page: Page, key: string, ms: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

test("월드: 자산 배치, 이동·회전·점프·리셋", async ({ page }) => {
  const errors = collectErrors(page);
  const id = await completedJob(page, "자동차");
  await page.goto(`/jobs/${id}/world`);
  await expect(page.getByTestId("world-canvas")).toBeVisible();
  await expect(page.getByTestId("collider-kind")).toContainText("convex hull");
  await expect.poll(() => page.evaluate(() => Boolean(window.__d2wWorld)), { timeout: 20_000 }).toBe(true);
  await page.locator("canvas").click({ position: { x: 20, y: 20 } }); // 포커스

  // 스폰 높이(1m)에서 떨어져 바닥에 착지 → 물리 동작
  await settle(page);
  const start = await pos(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/5-world.png` });

  // 이동 (W)
  await hold(page, "w", 700);
  const moved = await pos(page);
  expect(Math.hypot(moved[0] - start[0], moved[2] - start[2])).toBeGreaterThan(0.5);

  // 회전 (Q)
  const y0 = await yaw(page);
  await hold(page, "q", 500);
  expect(Math.abs((await yaw(page)) - y0)).toBeGreaterThan(0.3);

  // 점프 (Space)
  await settle(page);
  await page.keyboard.down("Space");
  await expect.poll(async () => (await pos(page))[1], { timeout: 3000 }).toBeGreaterThan(0.15);
  await page.keyboard.up("Space");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/5-world-jump.png` });

  // 리셋 (R)
  await hold(page, "r", 150);
  await settle(page);
  const back = await pos(page);
  expect(Math.hypot(back[0], back[2])).toBeLessThan(0.1);

  // 충돌체 보기
  await page.getByRole("button", { name: "충돌체 보기" }).click();
  await page.waitForTimeout(300);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/5-world-debug.png` });

  expect(errors.filter((e) => !e.includes("WebGL") && !e.includes("GPU stall"))).toEqual([]);
});
