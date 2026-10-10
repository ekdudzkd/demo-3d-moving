import { defineConfig } from "@playwright/test";

// 로컬은 설치된 Edge, CI는 PLAYWRIGHT_CHANNEL= (번들 chromium) 사용
const channel = process.env.PLAYWRIGHT_CHANNEL ?? "msedge";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5391",
    channel: channel || undefined,
    viewport: { width: 1400, height: 950 },
    screenshot: "only-on-failure",
  },
  outputDir: "e2e-results",
});
