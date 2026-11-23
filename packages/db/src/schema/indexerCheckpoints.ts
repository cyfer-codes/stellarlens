import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const indexerCheckpoints = pgTable("indexer_checkpoints", {
  network: text("network").primaryKey(),
  cursor: text("cursor").notNull(),
  latestLedger: integer("latest_ledger"),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  lastLedger: integer("last_ledger"),
  latestNetworkLedger: integer("latest_network_ledger"),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});