import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, ".")
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    css: true,
    // e2e/ holds Playwright specs, run separately via `pnpm test:e2e`.
    exclude: ["**/node_modules/**", "e2e/**"]
    css: true
  }
});
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    globals: true
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") }
  }
});
