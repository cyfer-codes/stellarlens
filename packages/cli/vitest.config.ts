import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.e2e.test.ts"],
    // The e2e suite spawns the api and the CLI binary as real processes.
    testTimeout: 30_000,
    hookTimeout: 60_000
  }
});
