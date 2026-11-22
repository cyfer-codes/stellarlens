import "dotenv/config";
import { notInArray } from "drizzle-orm";
import { createDb, STELLAR_NETWORKS } from "../index.js";
import { contracts } from "../schema/contracts.js";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const db = createDb();
  try {
    const unsupported = await db
      .select({
        id: contracts.id,
        address: contracts.address,
        name: contracts.name,
        network: contracts.network
      })
      .from(contracts)
      .where(notInArray(contracts.network, [...STELLAR_NETWORKS]))
      .orderBy(contracts.id);

    if (unsupported.length === 0) {
      console.log("All registered contracts use supported Stellar networks.");
      return;
    }

    console.error(
      `Found ${unsupported.length} contract(s) with unsupported networks. Supported values: ${STELLAR_NETWORKS.join(", ")}.`
    );
    for (const contract of unsupported) {
      console.error(
        JSON.stringify({
          id: contract.id,
          address: contract.address,
          name: contract.name,
          network: contract.network
        })
      );
    }
    process.exitCode = 1;
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error("Failed to report unsupported contract networks:", error);
  process.exitCode = 1;
});
