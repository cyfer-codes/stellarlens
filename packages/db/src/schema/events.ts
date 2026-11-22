import { bigint, bigserial, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { contracts } from "./contracts.js";

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    contractId: integer("contract_id")
      .notNull()
      .references(() => contracts.id),
    ledger: bigint("ledger", { mode: "number" }).notNull(),
    txHash: text("tx_hash").notNull(),
    topic: text("topic").notNull(),
    decodedData: jsonb("decoded_data"),
    ledgerClosedAt: timestamp("ledger_closed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index("events_contract_id_idx").on(table.contractId),
    index("events_ledger_idx").on(table.ledger),
    index("events_tx_hash_idx").on(table.txHash),
    index("events_ledger_closed_at_idx").on(table.ledgerClosedAt)
  ]
);