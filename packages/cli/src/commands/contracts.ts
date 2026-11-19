import type { StellarLensClient } from "@stellarlens/sdk";

export interface AddContractOptions {
  network: string;
  name?: string;
}

export async function addContract(
  client: StellarLensClient,
  address: string,
  options: AddContractOptions
): Promise<void> {
  const contract = await client.registerContract({ address, network: options.network, name: options.name });
  console.log(`registered contract ${contract.id}: ${contract.address} (${contract.network})`);
}

export interface ListContractsOptions {
  /** Case-insensitive substring filter on contract name. */
  name?: string;
  /** Exact network filter, e.g. "testnet". */
  network?: string;
  /** Page size used while paginating through the api (1–100). */
  pageSize?: number;
}

/** Prints every registered contract matching the filters, following the api's cursor pagination to the end. */
export async function listContracts(client: StellarLensClient, options: ListContractsOptions = {}): Promise<void> {
  const rows: Record<string, string | number>[] = [];

  for await (const contract of client.listAllContracts({
    name: options.name,
    network: options.network,
    limit: options.pageSize
  })) {
    rows.push({
      id: contract.id,
      address: contract.address,
      name: contract.name ?? "—",
      network: contract.network
    });
  }

  if (rows.length === 0) {
    console.log("No contracts registered.");
    return;
  }

  console.table(rows);
}
