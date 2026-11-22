DELETE FROM "token_transfers" AS duplicate
USING "token_transfers" AS original
WHERE duplicate."contract_id" = original."contract_id"
  AND duplicate."tx_hash" = original."tx_hash"
  AND duplicate."ledger" = original."ledger"
  AND duplicate."id" > original."id";
--> statement-breakpoint
CREATE UNIQUE INDEX "token_transfers_contract_tx_ledger_uidx" ON "token_transfers" USING btree ("contract_id", "tx_hash", "ledger");
