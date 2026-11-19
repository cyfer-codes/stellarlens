import { eq } from "drizzle-orm";
import {
  Account,
  Address,
  Contract,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  type rpc
} from "@stellar/stellar-sdk";
import { contracts, type Database } from "@stellarlens/db";

export interface ContractRegistration {
  address: string;
  name?: string;
  network: string;
}

/** Token metadata read from a SEP-41 contract via read-only simulation. */
export interface TokenMetadata {
  decimals: number | null;
  symbol: string | null;
  name: string | null;
}

/**
 * Minimal subset of the Soroban RPC server used to simulate token metadata
 * reads. Kept structural so tests can pass a lightweight mock.
 */
export interface SimulationServer {
  simulateTransaction(tx: unknown): Promise<rpc.Api.SimulateTransactionResponse>;
}

/** A throwaway, unfunded account used only as the simulation source. */
const SIMULATION_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const METADATA_METHODS = ["decimals", "symbol", "name"] as const;
type MetadataMethod = (typeof METADATA_METHODS)[number];

function extractReturnValue(response: rpc.Api.SimulateTransactionResponse): unknown {
  if (!("result" in response) || !response.result) {
    return undefined;
  }
  const retval = response.result.retval;
  if (!retval) {
    return undefined;
  }
  try {
    return scValToNative(retval);
  } catch {
    return undefined;
  }
}

/**
 * Read SEP-41 token metadata (`decimals`, `symbol`, `name`) from `address` by
 * simulating read-only contract calls. Non-token contracts (or any simulation
 * failure) yield `null` for the affected fields rather than throwing.
 */
export async function fetchTokenMetadata(
  server: SimulationServer,
  address: string,
  networkPassphrase: string
): Promise<TokenMetadata> {
  const metadata: TokenMetadata = { decimals: null, symbol: null, name: null };
  if (!StrKey.isValidContract(address)) {
    return metadata;
  }

  const contract = new Contract(address);
  const source = new Account(SIMULATION_SOURCE, "0");

  for (const method of METADATA_METHODS) {
    try {
      const tx = new TransactionBuilder(source, {
        fee: "100",
        networkPassphrase
      })
        .addOperation(contract.call(method))
        .setTimeout(0)
        .build();

      const response = await server.simulateTransaction(tx);
      const value = extractReturnValue(response);
      if (value === undefined || value === null) {
        continue;
      }
      if (method === "decimals") {
        const decimals = typeof value === "bigint" ? Number(value) : Number(value);
        if (Number.isFinite(decimals)) {
          metadata.decimals = decimals;
        }
      } else if (typeof value === "string") {
        metadata[method as Exclude<MetadataMethod, "decimals">] = value;
      }
    } catch {
      // Non-token contract or transient RPC failure: leave this field null.
    }
  }

  return metadata;
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

export interface RegisterContractOptions {
  /** Soroban RPC server used to simulate token metadata reads. */
  server?: SimulationServer;
  /** Network passphrase required to build the simulation transaction. */
  networkPassphrase?: string;
}

export async function registerContract(
  db: Database,
  registration: ContractRegistration,
  options: RegisterContractOptions = {}
) {
  assertValidStellarAddress(registration.address);

  let metadata: TokenMetadata | null = null;
  if (options.server && options.networkPassphrase) {
    metadata = await fetchTokenMetadata(options.server, registration.address, options.networkPassphrase);
  }

  const [row] = await db
    .insert(contracts)
    .values({
      address: registration.address,
      name: registration.name ?? null,
      network: registration.network,
      decimals: metadata?.decimals ?? null,
      symbol: metadata?.symbol ?? null,
      tokenName: metadata?.name ?? null
    })
    .onConflictDoUpdate({
      target: contracts.address,
      set: {
        name: registration.name ?? null,
        network: registration.network,
        decimals: metadata?.decimals ?? null,
        symbol: metadata?.symbol ?? null,
        tokenName: metadata?.name ?? null
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

export { Address, nativeToScVal };
