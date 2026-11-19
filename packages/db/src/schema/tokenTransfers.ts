import { bigint, bigserial, index, integer, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { contracts } from "./contracts.js";

export const tokenTransfers = pgTable(
  "token_transfers",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    contractId: integer("contract_id")
      .notNull()
      .references(() => contracts.id),
    from: text("from").notNull(),
    to: text("to").notNull(),
    amount: numeric("amount").notNull(),
    asset: text("asset").notNull(),
    txHash: text("tx_hash").notNull(),
    ledger: bigint("ledger", { mode: "number" }).notNull(),
    // Soroban RPC's event id (e.g. "0001234-0000000001"): unique per emitted event, so it
    // dedupes re-processed batches without collapsing several transfers in one transaction.
    rpcEventId: text("rpc_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index("token_transfers_contract_id_idx").on(table.contractId),
    index("token_transfers_tx_hash_idx").on(table.txHash),
    index("token_transfers_ledger_idx").on(table.ledger),
    // Composite indexes backing the contract-scoped transfer filters (from/to/asset) and the
    // top-accounts aggregation, ordered by id for stable cursor pagination.
    index("token_transfers_contract_from_id_idx").on(table.contractId, table.from, table.id),
    index("token_transfers_contract_to_id_idx").on(table.contractId, table.to, table.id),
    index("token_transfers_contract_asset_id_idx").on(table.contractId, table.asset, table.id),
    // Standalone indexes backing the cross-contract account history endpoint.
    index("token_transfers_from_idx").on(table.from),
    index("token_transfers_to_idx").on(table.to),
    uniqueIndex("token_transfers_rpc_event_id_uidx").on(table.rpcEventId)
  ]
);