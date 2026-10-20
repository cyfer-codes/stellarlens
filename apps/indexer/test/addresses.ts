import { createHash } from "node:crypto";
import { StrKey } from "@stellar/stellar-sdk";

/**
 * Derives a deterministic, valid Soroban contract (C...) strkey from `label`.
 *
 * Tests register contracts with placeholder labels such as "CONTRACT_A". The
 * registry now rejects anything that isn't a well-formed strkey, so this helper
 * turns those labels into real, unique, checksummed C... addresses. The same
 * label always maps to the same address, so it can be used for both the
 * registered address and the matching mock event `contractId`.
 */
export function contractAddress(label: string): string {
  return StrKey.encodeContract(createHash("sha256").update(label).digest());
}
