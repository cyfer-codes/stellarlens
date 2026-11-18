DROP INDEX "token_transfers_contract_tx_ledger_uidx";--> statement-breakpoint
ALTER TABLE "token_transfers" ADD COLUMN "rpc_event_id" text;--> statement-breakpoint
-- Backfill existing rows where exactly one transfer event matches; ambiguous rows stay NULL.
-- Transfers removed by 0009's (contract_id, tx_hash, ledger) dedupe are not recovered here:
-- re-index the affected ledgers to restore them.
UPDATE "token_transfers" AS t
SET "rpc_event_id" = m."rpc_event_id"
FROM (
  SELECT e."contract_id", e."tx_hash", e."ledger", min(e."decoded_data" ->> 'id') AS "rpc_event_id"
  FROM "events" AS e
  WHERE e."decoded_data" -> 'decoded' -> 'topic' ->> 0 = 'transfer'
  GROUP BY e."contract_id", e."tx_hash", e."ledger"
  HAVING count(DISTINCT e."decoded_data" ->> 'id') = 1
) AS m
WHERE t."contract_id" = m."contract_id"
  AND t."tx_hash" = m."tx_hash"
  AND t."ledger" = m."ledger";--> statement-breakpoint
CREATE UNIQUE INDEX "token_transfers_rpc_event_id_uidx" ON "token_transfers" USING btree ("rpc_event_id");
