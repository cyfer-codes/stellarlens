import "dotenv/config";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { assertMigrated, createDb, truncateAllTables, type Database } from "@stellarlens/db";
import { afterAll, afterEach, beforeAll } from "vitest";
import { AppModule } from "../src/app.module";

let app: INestApplication;
let db: Database;

export function getApp(): INestApplication {
  return app;
}

export function getTestDb(): Database {
  return db;
}

beforeAll(async () => {
  db = createDb();
  // Schema comes from `pnpm --filter @stellarlens/db db:migrate` (run by CI before tests), never
  // from the suite itself, so tests exercise exactly what the migrations produce.
  await assertMigrated(db);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
});

afterEach(async () => {
  await truncateAllTables(db);
});

afterAll(async () => {
  await app.close();
});
