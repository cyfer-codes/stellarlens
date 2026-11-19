import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export function createDb(connectionString: string = process.env.DATABASE_URL!) {
  const max = Number(process.env.DATABASE_POOL_MAX ?? 10);
  const client = postgres(connectionString, { max });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;

const globalForDb = globalThis as unknown as { __stellarlensDb?: Database };

/**
 * Memoized db client backed by a single connection pool. Cached on
 * globalThis so Next.js dev hot reload and repeated calls within the same
 * process reuse one pool instead of opening a new one per request.
 */
export function getDb(): Database {
  if (!globalForDb.__stellarlensDb) {
    globalForDb.__stellarlensDb = createDb();
  }
  return globalForDb.__stellarlensDb;
}
