import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const apiKeyScopes = ["full", "read"] as const;

export type ApiKeyScope = (typeof apiKeyScopes)[number];

export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  keyHash: text("key_hash").notNull().unique(),
  name: text("name"),
  scope: text("scope").$notNull().default("full"),
  revokedAt: timestamp("revoked_at", { withTimeZone: true }),
  createdAt: timestamp("created_at", { withTimeZone: true }).defaultNow().notNull()
});
