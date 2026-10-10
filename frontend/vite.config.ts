/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 백엔드(WSL 또는 로컬)의 API를 /api로 프록시한다
const API_TARGET = process.env.VITE_API_TARGET ?? "http://127.0.0.1:8077";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5391,
    strictPort: true,
    // assets/samples (저장소 루트) 이미지를 import하기 위해
    fs: { allow: [".."] },
    proxy: { "/api": { target: API_TARGET, changeOrigin: true } },
  },
  build: {
    chunkSizeWarningLimit: 2500,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    css: { modules: { classNameStrategy: "non-scoped" } },
  },
});
