import { defineConfig } from "@playwright/test";

/**
 * Runs against an already-running api + web stack (see CONTRIBUTING.md) —
 * it doesn't manage those servers itself, since the api needs a migrated
 * Postgres and a seeded admin user/api key first.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure"
  }
});
