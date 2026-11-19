import fs from "node:fs";
import path from "node:path";
import { StrKey } from "@stellar/stellar-sdk";
import type { Contract, StellarLensClient } from "@stellarlens/sdk";

export interface AddContractOptions {
  network: string;
  name?: string;
}

export interface AddContractsOptions {
  network: string;
  name?: string;
  file?: string;
}

export interface ContractTarget {
  address: string;
  name?: string;
}

export interface RegistrationResult {
  address: string;
  success: boolean;
  contract?: Contract;
  error?: string;
}

/**
 * Validates whether the given address is a well-formed Stellar contract (C...) or account (G...) strkey.
 */
export function isValidStellarAddress(address: string): boolean {
  if (!address || typeof address !== "string") {
    return false;
  }
  return StrKey.isValidContract(address) || StrKey.isValidEd25519PublicKey(address);
}

/**
 * Parses contract addresses and optional display names from a .txt or .json file.
 */
export function parseAddressesFromFile(filePath: string): ContractTarget[] {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`file not found: "${filePath}"`);
  }

  const raw = fs.readFileSync(resolvedPath, "utf-8").trim();
  if (!raw) {
    return [];
  }

  // Attempt JSON parsing if file extension is .json or starts with JSON brackets
  if (filePath.endsWith(".json") || raw.startsWith("[") || raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => {
          if (typeof item === "string") {
            return { address: item.trim() };
          }
          if (item && typeof item === "object" && typeof item.address === "string") {
            return {
              address: item.address.trim(),
              name: typeof item.name === "string" ? item.name.trim() : undefined
            };
          }
          throw new Error(
            "Invalid item in JSON array; expected string or { address, name? } object"
          );
        });
      }

      if (parsed && typeof parsed === "object") {
        const objRecord = parsed as Record<string, unknown>;
        const list = Array.isArray(objRecord.addresses)
          ? objRecord.addresses
          : Array.isArray(objRecord.contracts)
            ? objRecord.contracts
            : null;
        if (list) {
          return list.map((item: unknown) => {
            if (typeof item === "string") {
              return { address: item.trim() };
            }
            if (item && typeof item === "object") {
              const itemRecord = item as Record<string, unknown>;
              if (typeof itemRecord.address === "string") {
                return {
                  address: itemRecord.address.trim(),
                  name: typeof itemRecord.name === "string" ? itemRecord.name.trim() : undefined
                };
              }
            }
            throw new Error(
              "Invalid item in JSON list; expected string or { address, name? } object"
            );
          });
        }
      }
    } catch (err) {
      if (filePath.endsWith(".json")) {
        throw new Error(`failed to parse JSON file "${filePath}": ${(err as Error).message}`);
      }
    }
  }

  // Plain text (newline-delimited)
  const lines = raw.split(/\r?\n/);
  const targets: ContractTarget[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) {
      continue;
    }
    const clean = trimmed.replace(/#.*$/, "").trim();
    if (!clean) continue;

    const parts = clean.split(/\s+/);
    const address = parts[0];
    const name = parts.slice(1).join(" ") || undefined;
    targets.push({ address, name });
  }

  return targets;
}

/**
 * Registers one or more contracts, validating strkeys before sending and reporting per-address results.
 * Returns true if all addresses succeeded, false if any failed.
 */
export async function addContracts(
  client: StellarLensClient,
  addresses: string[] = [],
  options: AddContractsOptions
): Promise<boolean> {
  const targets: ContractTarget[] = [];

  if (options.file) {
    try {
      const fromFile = parseAddressesFromFile(options.file);
      targets.push(...fromFile);
    } catch (err) {
      console.error(`Error loading file "${options.file}": ${(err as Error).message}`);
      return false;
    }
  }

  for (const addr of addresses) {
    const trimmed = addr.trim();
    if (trimmed) {
      const name = addresses.length === 1 && !options.file ? options.name : undefined;
      targets.push({ address: trimmed, name });
    }
  }

  if (targets.length === 0) {
    console.error("Error: No contract addresses provided. Specify addresses or use --file.");
    return false;
  }

  const results: RegistrationResult[] = [];
  const validTargets: ContractTarget[] = [];

  // Validate every strkey before sending
  for (const target of targets) {
    if (!isValidStellarAddress(target.address)) {
      results.push({
        address: target.address,
        success: false,
        error: "invalid Stellar strkey (must be a well-formed C... contract or G... account)"
      });
    } else {
      validTargets.push(target);
    }
  }

  // Bulk registration when available, otherwise sequential
  if (validTargets.length > 0) {
    const clientRecord = client as unknown as Record<string, unknown>;
    if (typeof clientRecord.registerContracts === "function") {
      try {
        const bulkRegister = clientRecord.registerContracts as (
          items: Array<{ address: string; network: string; name?: string }>
        ) => Promise<Contract[]>;
        const bulkRes = await bulkRegister(
          validTargets.map((t) => ({
            address: t.address,
            network: options.network,
            name: t.name
          }))
        );
        for (let i = 0; i < validTargets.length; i++) {
          results.push({
            address: validTargets[i].address,
            success: true,
            contract: bulkRes[i]
          });
        }
      } catch (err) {
        for (const target of validTargets) {
          results.push({
            address: target.address,
            success: false,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    } else {
      // Sequential requests
      for (const target of validTargets) {
        try {
          const contract = await client.registerContract({
            address: target.address,
            network: options.network,
            name: target.name
          });
          results.push({
            address: target.address,
            success: true,
            contract
          });
        } catch (err) {
          results.push({
            address: target.address,
            success: false,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    }
  }

  // Report per-address result
  for (const res of results) {
    if (res.success && res.contract) {
      console.log(
        `✓ ${res.address}: registered (id: ${res.contract.id}, network: ${res.contract.network}${
          res.contract.name ? `, name: "${res.contract.name}"` : ""
        })`
      );
    } else {
      console.error(`✗ ${res.address}: ${res.error}`);
    }
  }

  return results.every((r) => r.success);
}

export async function addContract(
  client: StellarLensClient,
  address: string,
  options: AddContractOptions
): Promise<void> {
  const success = await addContracts(client, [address], options);
  if (!success) {
    throw new Error(`failed to register contract ${address}`);
  }
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
