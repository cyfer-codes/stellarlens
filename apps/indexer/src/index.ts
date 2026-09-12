import { rpc } from "@stellar/stellar-sdk";
import { createDb } from "@stellarlens/db";
import { POLL_INTERVAL_MS, SOROBAN_RPC_URL, STELLAR_NETWORK } from "./config.js";
import { processEventsBatch } from "./events.js";
import { startRegistryServer } from "./server.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const server = new rpc.Server(SOROBAN_RPC_URL);
  const db = createDb();

  startRegistryServer(db);
  console.log(`indexer starting: network=${STELLAR_NETWORK} rpc=${SOROBAN_RPC_URL} poll=${POLL_INTERVAL_MS}ms`);

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

main();
