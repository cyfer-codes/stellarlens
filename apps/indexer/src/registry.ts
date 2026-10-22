import { eq } from "drizzle-orm";
import { StrKey } from "@stellar/stellar-sdk";
import { contracts, type Database } from "@stellarlens/db";

export interface ContractRegistration {
  address: string;
  name?: string;
  network: string;
}

/**
 * Validate that `address` is a well-formed Stellar strkey before it is stored.
 *
 * Both contract (C...) and Ed25519 account (G...) strkeys are accepted: each is
 * a valid, checksummed SEP-23 address (56 chars). The indexer only emits events
 * for registered addresses that match a contract event's `contractId`, which is
 * always a C... strkey (the events request filters on `type: "contract"`), so a
 * registered G... account address will not currently be matched/indexed. It is
 * still accepted at registration so the registry stays decoupled from the
 * indexing pipeline's semantics.
 *
 * @throws Error with a descriptive message when the address is malformed.
 */
export function assertValidStellarAddress(address: string): void {
  if (typeof address !== "string" || address.length === 0) {
    throw new Error("address is required and must be a non-empty Stellar strkey (C... or G...)");
  }
  if (StrKey.isValidContract(address) || StrKey.isValidEd25519PublicKey(address)) {
    return;
  }
  throw new Error(
    `invalid Stellar address: "${address}" is not a well-formed contract (C...) or account (G...) strkey`
  );
}

export async function registerContract(db: Database, registration: ContractRegistration) {
  assertValidStellarAddress(registration.address);
  const [row] = await db
    .insert(contracts)
    .values({
      address: registration.address,
      name: registration.name ?? null,
      network: registration.network
    })
    .onConflictDoUpdate({
      target: contracts.address,
      set: {
        name: registration.name ?? null,
        network: registration.network
      }
    })
    .returning();
  return row;
}

/** Maps registered contract address -> internal id, scoped to one network. */
export async function loadRegisteredContracts(db: Database, network: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: contracts.id, address: contracts.address })
    .from(contracts)
    .where(eq(contracts.network, network));
  return new Map(rows.map((row) => [row.address, row.id]));
}
