import { createHash, randomBytes } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { apiKeys, createDb } from "@stellarlens/db";

export interface ApiKeyRow {
  id: number;
  name: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface GeneratedApiKey extends ApiKeyRow {
  key: string;
}

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const db = createDb();
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      createdAt: apiKeys.createdAt,
      revokedAt: apiKeys.revokedAt
    })
    .from(apiKeys)
    .orderBy(desc(apiKeys.createdAt));

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null
  }));
}

export async function generateApiKey(name?: string): Promise<GeneratedApiKey> {
  const db = createDb();
  const rawKey = randomBytes(24).toString("hex");
  const keyHash = createHash("sha256").update(rawKey).digest("hex");

  const [created] = await db
    .insert(apiKeys)
    .values({ keyHash, name: name ?? null })
    .returning({ id: apiKeys.id, name: apiKeys.name, createdAt: apiKeys.createdAt });

  return { ...created, createdAt: created.createdAt.toISOString(), revokedAt: null, key: rawKey };
}

/** Returns false if no key with that id exists; otherwise revokes (idempotently) and returns true. */
export async function revokeApiKey(id: number): Promise<boolean> {
  const db = createDb();
  const [existing] = await db.select({ id: apiKeys.id, revokedAt: apiKeys.revokedAt }).from(apiKeys).where(eq(apiKeys.id, id));

  if (!existing) {
    return false;
  }
  if (!existing.revokedAt) {
    await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
  }

  return true;
}
