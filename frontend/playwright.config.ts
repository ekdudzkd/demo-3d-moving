import { defineConfig } from "@playwright/test";

// 로컬은 설치된 Edge, CI는 PLAYWRIGHT_CHANNEL= (번들 chromium) 사용
const channel = process.env.PLAYWRIGHT_CHANNEL ?? "msedge";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  // 백엔드 워커가 1개(D-002)라 작업이 서로 기다리지 않도록 순차 실행
  workers: 1,
  fullyParallel: false,
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
