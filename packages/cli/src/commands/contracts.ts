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
