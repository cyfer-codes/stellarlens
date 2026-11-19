import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const indexerCheckpoints = pgTable("indexer_checkpoints", {
  network: text("network").primaryKey(),
  cursor: text("cursor").notNull(),
  latestLedger: integer("latest_ledger"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});
