import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const apiKeyScopes = ["full", "read"] as const;

export type ApiKeyScope = (typeof apiKeyScopes)[number];

export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  keyHash: text("key_hash").notNull().unique(),
  name: text("name"),
  scope: text("scope").notNull().default("full"),
  rateLimitPerMinute: integer("rate_limit_per_minute"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  // Used both for explicit key expiry and for rotation grace periods
  // (during rotation, the old key's expiresAt is set to now + grace period).
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});