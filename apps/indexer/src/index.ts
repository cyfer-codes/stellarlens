import { rpc } from "@stellar/stellar-sdk";
import { createDb } from "@stellarlens/db";
import { POLL_INTERVAL_MS, POLL_ONCE, SOROBAN_RPC_URL, STELLAR_NETWORK } from "./config.js";
import { processEventsBatch } from "./events.js";
import { startRegistryServer } from "./server.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const server = new rpc.Server(SOROBAN_RPC_URL);
  const db = createDb();

  console.log(
    `indexer starting: network=${STELLAR_NETWORK} rpc=${SOROBAN_RPC_URL} poll=${POLL_INTERVAL_MS}ms`
  );

  if (POLL_ONCE) {
    try {
      const { indexedCount, cursor } = await processEventsBatch(db, server);
      console.log(`poll cycle: indexed ${indexedCount} event(s), cursor=${cursor}`);
    } finally {
      await db.$client.end();
    }
    return;
  }

  startRegistryServer(db);

  for (;;) {
    try {
      const { indexedCount, cursor } = await processEventsBatch(db, server);
      console.log(`poll cycle: indexed ${indexedCount} event(s), cursor=${cursor}`);
    } catch (err) {
      console.error("failed to process events batch:", err);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((err: unknown) => {
  console.error("indexer failed:", err);
  process.exitCode = 1;
});
