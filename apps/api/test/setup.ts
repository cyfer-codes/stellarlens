import "dotenv/config";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, type Database } from "@stellarlens/db";
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
  try {
    db = createDb();
    await migrate(db, { migrationsFolder: "../../packages/db/migrations" });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  } catch {
    // Allows unit tests to run when postgres is not available
  }
});

afterEach(async () => {
  if (db) {
    try {
      await db.execute(
        sql`TRUNCATE TABLE token_transfers, events, indexer_checkpoints, webhooks, api_keys, contracts RESTART IDENTITY CASCADE`
      );
    } catch {
      // ignore
    }
  }
});

afterAll(async () => {
  if (app) {
    await app.close();
  }
});
