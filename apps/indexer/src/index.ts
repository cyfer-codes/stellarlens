import { createDb } from "@stellarlens/db";
import {
  POLL_INTERVAL_MS,
  POLL_ONCE,
  SOROBAN_RPC_URLS,
  STELLAR_NETWORK,
} from "./config.js";
import { processEventsBatch } from "./events.js";
import { createLogger } from "./logger.js";
import { createEndpointManager } from "./retry.js";
import { startRegistryServer } from "./server.js";

const log = createLogger("indexer");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const endpoints = createEndpointManager(SOROBAN_RPC_URLS, { log });
  const db = createDb();

  log.info("indexer starting", {
    network: STELLAR_NETWORK,
    rpcEndpoints: SOROBAN_RPC_URLS,
    rpc: endpoints.currentUrl(),
    pollIntervalMs: POLL_INTERVAL_MS,
  });

  if (POLL_ONCE) {
    try {
      const { indexedCount, cursor } = await processEventsBatch(db, endpoints);
      log.info("poll cycle", { indexedCount, cursor });
    } finally {
      await db.$client.end();
    }
    return;
  }

  startRegistryServer(db);

  for (;;) {
    try {
      const { indexedCount, cursor } = await processEventsBatch(db, endpoints);
      log.info("poll cycle", { indexedCount, cursor });
    } catch (err) {
      log.error("failed to process events batch", {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        rpc: endpoints.currentUrl(),
      });
    }
    // Periodically probe the primary endpoint and fail back when it recovers.
    await endpoints.maybeProbePrimary();
    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((err: unknown) => {
  log.error("indexer failed", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exitCode = 1;
});