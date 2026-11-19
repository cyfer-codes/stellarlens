import "dotenv/config";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";
import { assertMigrated, createDb, truncateAllTables, type Database } from "@stellarlens/db";

export const mswServer = setupServer();

let db: Database;

export function getTestDb(): Database {
  return db;
}

beforeAll(async () => {
  db = createDb();
  // Schema comes from `pnpm --filter @stellarlens/db db:migrate` (run by CI before tests), never
  // from the suite itself, so tests exercise exactly what the migrations produce.
  await assertMigrated(db);
  mswServer.listen({ onUnhandledRequest: "error" });
});

afterEach(async () => {
  await truncateAllTables(db);
  mswServer.resetHandlers();
});

afterAll(() => {
  mswServer.close();
});
