import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { StellarLensApiError, type StellarLensClient } from "@stellarlens/sdk";
import { isValidStellarAddress } from "../strkey.js";

/** Matches the api's `ArrayMaxSize` on `POST /contracts/bulk`. */
export const BULK_CHUNK_SIZE = 100;

export interface ContractEntry {
  address: string;
  network?: string;
  name?: string;
}

export interface AddContractsOptions {
  /** Default network for entries that don't set their own. */
  network?: string;
  /** Display name; only allowed when registering a single address. */
  name?: string;
}

export type AddContractStatus =
  /** Newly registered (bulk). */
  | "created"
  /** Already registered, left untouched (bulk). */
  | "existing"
  /** Registered or updated via the single-contract endpoint, which upserts. */
  | "registered"
  /** Repeated in the input; only the first occurrence was sent. */
  | "duplicate"
  /** Rejected locally before anything was sent. */
  | "invalid"
  /** Rejected by the api. */
  | "error";

export interface AddContractResult {
  address: string;
  network: string | null;
  status: AddContractStatus;
  id?: number;
  error?: string;
}

const FAILED_STATUSES: ReadonlySet<AddContractStatus> = new Set(["invalid", "error"]);

export function isFailure(result: AddContractResult): boolean {
  return FAILED_STATUSES.has(result.status);
}

function describeError(error: unknown): string {
  if (error instanceof StellarLensApiError) {
    const body = error.body as { message?: unknown } | string | undefined;
    const message =
      typeof body === "object" && body !== null && "message" in body ? body.message : body;
    if (Array.isArray(message)) {
      return `${error.status}: ${message.join("; ")}`;
    }
    if (typeof message === "string" && message.length > 0) {
      return `${error.status}: ${message}`;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/** The api predates `POST /contracts/bulk` (or proxies it away), so fall back to one request per address. */
function isBulkUnavailable(error: unknown): boolean {
  return error instanceof StellarLensApiError && (error.status === 404 || error.status === 405);
}

function toEntry(value: unknown, position: string): ContractEntry {
  if (typeof value === "string") {
    return { address: value.trim() };
  }
  if (typeof value === "object" && value !== null && "address" in value) {
    const { address, network, name } = value as Record<string, unknown>;
    if (
      typeof address !== "string" ||
      (network !== undefined && typeof network !== "string") ||
      (name !== undefined && name !== null && typeof name !== "string")
    ) {
      throw new Error(`${position}: address, network and name must be strings`);
    }
    return {
      address: address.trim(),
      ...(network !== undefined ? { network: network.trim() } : {}),
      ...(typeof name === "string" ? { name } : {})
    };
  }
  throw new Error(`${position}: expected an address string or an { address, network?, name? } object`);
}

/**
 * Parses a contracts file.
 *
 * - `.json`: an array (or `{ "items": [...] }`) of address strings or
 *   `{ "address", "network"?, "name"? }` objects.
 * - anything else: plain text, one address per line; blank lines and `#` comments are ignored.
 */
export function parseContractsFile(path: string, contents: string): ContractEntry[] {
  if (extname(path).toLowerCase() === ".json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch (error) {
      throw new Error(`${path}: invalid JSON (${(error as Error).message})`);
    }
    const items =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && "items" in parsed
        ? (parsed as { items: unknown }).items
        : parsed;
    if (!Array.isArray(items)) {
      throw new Error(`${path}: expected a JSON array or an object with an "items" array`);
    }
    return items.map((item, index) => toEntry(item, `${path}[${index}]`));
  }

  return contents
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line.length > 0)
    .map((address) => ({ address }));
}

export async function readContractsFile(path: string): Promise<ContractEntry[]> {
  return parseContractsFile(path, await readFile(path, "utf8"));
}

interface ValidEntry {
  /** Position in the original input, so results print in input order. */
  position: number;
  address: string;
  network: string;
  name?: string;
}

async function registerSequentially(
  client: StellarLensClient,
  entries: ValidEntry[],
  results: AddContractResult[]
): Promise<void> {
  for (const entry of entries) {
    try {
      const contract = await client.registerContract({
        address: entry.address,
        network: entry.network,
        name: entry.name
      });
      results[entry.position] = {
        address: contract.address,
        network: contract.network,
        status: "registered",
        id: contract.id
      };
    } catch (error) {
      results[entry.position] = {
        address: entry.address,
        network: entry.network,
        status: "error",
        error: describeError(error)
      };
    }
  }
}

async function registerInBulk(
  client: StellarLensClient,
  entries: ValidEntry[],
  results: AddContractResult[]
): Promise<void> {
  for (let start = 0; start < entries.length; start += BULK_CHUNK_SIZE) {
    const chunk = entries.slice(start, start + BULK_CHUNK_SIZE);

    let response;
    try {
      response = await client.registerContractsBulk(
        chunk.map(({ address, network, name }) => ({ address, network, name }))
      );
    } catch (error) {
      if (start === 0 && isBulkUnavailable(error)) {
        await registerSequentially(client, entries, results);
        return;
      }
      for (const entry of chunk) {
        results[entry.position] = {
          address: entry.address,
          network: entry.network,
          status: "error",
          error: describeError(error)
        };
      }
      continue;
    }

    for (const [index, entry] of chunk.entries()) {
      const item = response.results.find((result) => result.index === index);
      results[entry.position] = item
        ? {
            address: item.address ?? entry.address,
            network: item.network ?? entry.network,
            status: item.status,
            ...(item.id !== undefined ? { id: item.id } : {}),
            ...(item.error ? { error: item.error } : {})
          }
        : {
            address: entry.address,
            network: entry.network,
            status: "error",
            error: "missing from bulk response"
          };
    }
  }
}

/**
 * Validates every address locally, then registers the valid ones: a single address goes through
 * `POST /contracts` (preserving its upsert semantics), several go through `POST /contracts/bulk` in
 * chunks of {@link BULK_CHUNK_SIZE}, falling back to one request per address when the api doesn't
 * expose the bulk endpoint. Returns one result per input entry, in input order.
 */
export async function addContracts(
  client: StellarLensClient,
  entries: ContractEntry[],
  options: AddContractsOptions = {}
): Promise<AddContractResult[]> {
  if (options.name !== undefined && entries.length > 1) {
    throw new Error("--name can only be used when registering a single address");
  }

  const results: AddContractResult[] = new Array(entries.length);
  const valid: ValidEntry[] = [];
  const seen = new Set<string>();

  for (const [position, entry] of entries.entries()) {
    const network = (entry.network ?? options.network)?.trim() || null;

    if (!isValidStellarAddress(entry.address)) {
      results[position] = {
        address: entry.address,
        network,
        status: "invalid",
        error: "not a well-formed Stellar contract (C...) or account (G...) strkey"
      };
    } else if (!network) {
      results[position] = {
        address: entry.address,
        network,
        status: "invalid",
        error: "no network: pass --network or set one per entry in the file"
      };
    } else if (seen.has(entry.address)) {
      results[position] = { address: entry.address, network, status: "duplicate" };
    } else {
      seen.add(entry.address);
      valid.push({ position, address: entry.address, network, name: entry.name ?? options.name });
    }
  }

  if (valid.length === 1) {
    await registerSequentially(client, valid, results);
  } else if (valid.length > 1) {
    await registerInBulk(client, valid, results);
  }

  return results;
}

const STATUS_LABEL: Record<AddContractStatus, string> = {
  created: "created",
  existing: "existing",
  registered: "registered",
  duplicate: "skipped",
  invalid: "invalid",
  error: "failed"
};

export function formatResult(result: AddContractResult): string {
  const label = STATUS_LABEL[result.status].padEnd(10);
  const network = result.network ? ` (${result.network})` : "";
  const id = result.id !== undefined ? ` id=${result.id}` : "";
  const detail =
    result.status === "duplicate"
      ? " — duplicate in input"
      : result.error
        ? ` — ${result.error}`
        : "";
  return `${isFailure(result) ? "✗" : "✓"} ${label} ${result.address || "<empty>"}${network}${id}${detail}`;
}

/**
 * Registers every entry, printing one line per address and a summary. Returns `false` if any
 * address failed validation or registration, so the caller can exit non-zero.
 */
export async function runAddContracts(
  client: StellarLensClient,
  entries: ContractEntry[],
  options: AddContractsOptions = {}
): Promise<boolean> {
  if (entries.length === 0) {
    console.error("No contract addresses given.");
    return false;
  }

  const results = await addContracts(client, entries, options);
  for (const result of results) {
    (isFailure(result) ? console.error : console.log)(formatResult(result));
  }

  const failed = results.filter(isFailure).length;
  console.log(`${results.length - failed} succeeded, ${failed} failed (${results.length} total)`);
  return failed === 0;
}

export async function listContracts(client: StellarLensClient): Promise<void> {
  const contracts = await client.listContracts();

  if (contracts.length === 0) {
    console.log("No contracts registered.");
    return;
  }

  console.table(
    contracts.map((contract) => ({
      id: contract.id,
      address: contract.address,
      name: contract.name ?? "—",
      network: contract.network
    }))
  );
}
