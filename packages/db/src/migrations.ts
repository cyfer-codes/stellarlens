import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { Database } from "./client.js";

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/**
 * Absolute path to `packages/db/migrations` (resolves the same from `src/` and `dist/`).
 *
 * Computed on demand rather than at import time so bundlers that rewrite `import.meta.url`
 * (Next.js) never have to resolve it for code that only uses the schema.
 */
export function getMigrationsFolder(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
}

function readJournal(): JournalEntry[] {
  const journal = JSON.parse(
    readFileSync(resolve(getMigrationsFolder(), "meta", "_journal.json"), "utf8")
  ) as { entries: JournalEntry[] };
  return journal.entries;
}

/**
 * Tags of migrations in `migrations/meta/_journal.json` that haven't been applied to `db`.
 *
 * Uses the same bookkeeping as `drizzle-kit migrate` and drizzle-orm's `migrate()`: the
 * `drizzle.__drizzle_migrations` table records each applied migration's journal `when`, and a
 * migration is pending if its `when` is newer than the latest one recorded.
 */
export async function getPendingMigrations(db: Database): Promise<string[]> {
  const entries = readJournal();

  const [{ exists }] = await db.execute<{ exists: boolean }>(
    sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists`
  );
  if (!exists) {
    return entries.map((entry) => entry.tag);
  }

  const [{ last }] = await db.execute<{ last: string | null }>(
    sql`SELECT max(created_at)::text AS last FROM drizzle.__drizzle_migrations`
  );
  const lastApplied = last === null ? -1 : Number(last);
  return entries.filter((entry) => entry.when > lastApplied).map((entry) => entry.tag);
}

/**
 * Throws unless every migration has been applied. Test suites call this instead of creating
 * tables themselves, so they always run against the schema `db:migrate` produces.
 */
export async function assertMigrated(db: Database): Promise<void> {
  const pending = await getPendingMigrations(db);
  if (pending.length > 0) {
    throw new Error(
      `database is missing ${pending.length} migration(s): ${pending.join(", ")}. ` +
        "Run `pnpm --filter @stellarlens/db db:migrate` against DATABASE_URL first."
    );
  }
}

/**
 * Empties every table in the `public` schema and resets identity sequences. The table list
 * comes from the migrated database itself, so new tables are covered without editing tests.
 */
export async function truncateAllTables(db: Database): Promise<void> {
  const tables = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  if (tables.length === 0) {
    return;
  }
  const list = sql.join(
    tables.map(({ tablename }) => sql`${sql.identifier("public")}.${sql.identifier(tablename)}`),
    sql.raw(", ")
  );
  await db.execute(sql`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
