import type { StellarLensClient } from "@stellarlens/sdk";

export interface AddContractOptions {
  network: string;
  name?: string;
}

export async function addContract(
  client: StellarLensClient,
  address: string,
  options: AddContractOptions,
  json = false
): Promise<void> {
  const contract = await client.registerContract({ address, network: options.network, name: options.name });
  if (json) {
    console.log(JSON.stringify(contract));
    return;
  }
  console.log(`registered contract ${contract.id}: ${contract.address} (${contract.network})`);
}

export async function listContracts(client: StellarLensClient, json = false): Promise<void> {
  const contracts = await client.listContracts();

  if (json) {
    console.log(JSON.stringify(contracts));
    return;
  }

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
