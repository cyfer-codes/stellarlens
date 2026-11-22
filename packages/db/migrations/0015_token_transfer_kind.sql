ALTER TABLE "token_transfers" ADD COLUMN "kind" text NOT NULL DEFAULT 'transfer';
CREATE INDEX "token_transfers_contract_kind_idx" ON "token_transfers" ("contract_id", "kind");