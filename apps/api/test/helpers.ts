import { createHash, randomBytes } from "node:crypto";
import { StrKey } from "@stellar/stellar-sdk";
import { apiKeys, type ApiKeyScope, type Database } from "@stellarlens/db";

export async function createApiKey(db: Database, options: { scope?: ApiKeyScope } = {}): Promise<string> {
  const rawKey = randomBytes(24).toString("hex");
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  await db.insert(apiKeys).values({ keyHash, scope: options.scope ?? "full" });
  return rawKey;
}

/**
 * Derives a deterministic, valid Soroban contract (C...) strkey from `label`.
 *
 * `CreateContractDto` now rejects anything that isn't a well-formed strkey, so
 * e2e tests use this to turn placeholder labels into real, unique, checksummed
 * C... addresses. The same label always maps to the same address, so it can be
 * used in both the request body and any assertions on the stored address.
 */
export function contractAddress(label: string): string {
  return StrKey.encodeContract(createHash("sha256").update(label).digest());
}
