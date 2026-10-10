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
    proxy: { "/api": { target: API_TARGET, changeOrigin: true } },
  },
  build: {
    chunkSizeWarningLimit: 2500,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    css: { modules: { classNameStrategy: "non-scoped" } },
  },
});
