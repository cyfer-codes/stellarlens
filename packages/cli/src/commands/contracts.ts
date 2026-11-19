import type { Contract, StellarLensClient } from "@stellarlens/sdk";

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

/** Fetches every registered contract, following `nextCursor` until the last page. */
async function fetchAllContracts(client: StellarLensClient): Promise<Contract[]> {
  const contracts: Contract[] = [];
  let cursor: number | undefined;
  do {
    const page = await client.listContracts({ cursor, limit: 100 });
    contracts.push(...page.data);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return contracts;
}

export async function listContracts(client: StellarLensClient): Promise<void> {
  const contracts = await fetchAllContracts(client);

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
