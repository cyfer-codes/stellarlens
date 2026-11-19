-- Migration 0013: transfer filter indexes
--
-- Adds composite indexes backing the transfer list filters introduced in
-- #80/#81 and the asset filter, plus account-centric lookups (#276) and the
-- top senders/receivers stats endpoint (#275).
--
-- All statements are idempotent (IF NOT EXISTS) and data-neutral: no table
-- or column changes, no data rewrites.
--
-- PR note: EXPLAIN (ANALYZE, BUFFERS) before/after on a seeded dataset is
-- included in the PR description. Before: sequential scans on token_transfers
-- for filtered queries on large contracts. After: index scans on the
-- composite indexes below.

-- Contract-scoped sender filter: WHERE contract_id = $1 AND "from" = $2
-- ORDER BY id (cursor pagination).
CREATE INDEX IF NOT EXISTS token_transfers_contract_from_id_idx
  ON token_transfers (contract_id, "from", id);

-- Contract-scoped receiver filter: WHERE contract_id = $1 AND "to" = $2
-- ORDER BY id (cursor pagination).
CREATE INDEX IF NOT EXISTS token_transfers_contract_to_id_idx
  ON token_transfers (contract_id, "to", id);

-- Contract-scoped asset filter: WHERE contract_id = $1 AND asset = $2
-- ORDER BY id (cursor pagination).
CREATE INDEX IF NOT EXISTS token_transfers_contract_asset_id_idx
  ON token_transfers (contract_id, asset, id);

-- Account-centric transfer history across all contracts (#276):
-- WHERE "from" = $1 ORDER BY id / WHERE "to" = $1 ORDER BY id.
CREATE INDEX IF NOT EXISTS token_transfers_from_idx
  ON token_transfers ("from");

CREATE INDEX IF NOT EXISTS token_transfers_to_idx
  ON token_transfers ("to");