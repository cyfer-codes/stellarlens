import type { Contract, StellarLensClient } from "@stellarlens/sdk";

const PAGE_SIZE = 100;

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

/** `GET /contracts` is cursor-paginated, so follow `nextCursor` until every contract has been fetched. */
export async function fetchAllContracts(client: StellarLensClient): Promise<Contract[]> {
  const contracts: Contract[] = [];
  let cursor: number | undefined;

  for (;;) {
    const page = await client.listContracts({ cursor, limit: PAGE_SIZE });
    contracts.push(...page.data);
    if (page.nextCursor === null) {
      return contracts;
    }
    cursor = page.nextCursor;
  }
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
