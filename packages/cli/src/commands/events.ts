import type { EventRecord, StellarLensClient } from "@stellarlens/sdk";

const POLL_INTERVAL_MS = 5000;
const PAGE_SIZE = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatEvent(event: EventRecord): Record<string, string> {
  const decoded = event.decodedData?.decoded;
  return {
    id: String(event.id),
    ledger: String(event.ledger),
    txHash: `${event.txHash.slice(0, 12)}…`,
    topic: decoded ? JSON.stringify(decoded.topic) : "—",
    value: decoded ? JSON.stringify(decoded.value) : "—"
  };
}

/**
 * Fetches events newer than `cursor` and prints any that arrived, returning the cursor to poll from next.
 * Advances to the last *returned* event's own id — not `nextCursor`, which the api only sets when a page
 * overflows `limit`. Using `nextCursor` here would leave the cursor stuck at null forever once caught up,
 * re-printing the same events on every poll.
 */
export async function pollNewEvents(
  client: StellarLensClient,
  contractId: number,
  cursor: number | undefined
): Promise<number | undefined> {
  const page = await client.listEvents(contractId, { cursor, limit: PAGE_SIZE });

  if (page.data.length === 0) {
    return cursor;
  }

  console.table(page.data.map(formatEvent));
  return page.data[page.data.length - 1].id;
}

export async function tailEvents(client: StellarLensClient, contractId: number): Promise<void> {
  console.log(`tailing events for contract ${contractId} (ctrl+c to stop)...`);

  let cursor: number | undefined;
  for (;;) {
    try {
      cursor = await pollNewEvents(client, contractId, cursor);
    } catch (err) {
      console.error("failed to fetch events:", err instanceof Error ? err.message : err);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}
