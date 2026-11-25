import type { EventRecord, StellarLensClient } from "@stellarlens/sdk";

export const DEFAULT_POLL_INTERVAL_MS = 5000;

export function formatEvent(event: EventRecord): string {
  const decoded = event.decodedData?.decoded;
  return [
    `#${event.id}`,
    `ledger ${event.ledger}`,
    `tx ${event.txHash.slice(0, 12)}…`,
    `topic ${decoded ? JSON.stringify(decoded.topic) : "—"}`,
    `value ${decoded ? JSON.stringify(decoded.value) : "—"}`
  ].join("  ");
}

export interface TailEventsOptions {
  /** Skip existing events and only print ones indexed from now on. */
  latest?: boolean;
  /** Poll interval in ms once caught up. */
  intervalMs?: number;
  /** Aborting stops the tail cleanly (wired to ctrl+c by the CLI). */
  signal?: AbortSignal;
  /** Print each event as a line of JSON instead of the formatted summary. */
  json?: boolean;
}

export interface ListEventsOptions {
  limit?: number;
  cursor?: number;
  topic?: string;
  from?: string;
  to?: string;
}

/** Prints one page of a contract's events, and the cursor for the next page when there is one. */
export async function listEvents(
  client: StellarLensClient,
  contractId: number,
  options: ListEventsOptions = {}
): Promise<void> {
  const page = await client.listEvents(contractId, {
    cursor: options.cursor,
    limit: options.limit,
    topic: options.topic,
    from: options.from,
    to: options.to
  });

  if (page.data.length === 0) {
    console.log("No events found.");
    return;
  }

  console.table(page.data.map(formatEvent));
  if (page.nextCursor !== null) {
    console.log(`more events available: fetch the next page with --cursor ${page.nextCursor}`);
  }
}

/**
 * Prints a contract's events as they arrive, until `signal` aborts. Polling, cursor tracking and error backoff all
 * live in the SDK's `watchEvents`.
 */
export async function tailEvents(
  client: StellarLensClient,
  contractId: number,
  options: TailEventsOptions = {}
): Promise<void> {
  console.log(`tailing events for contract ${contractId} (ctrl+c to stop)...`);

  for await (const event of client.watchEvents(contractId, {
    intervalMs: options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    startAt: options.latest ? "latest" : undefined,
    signal: options.signal,
    onError: (err, { retryInMs }) => {
      console.error(
        `failed to fetch events: ${err instanceof Error ? err.message : String(err)} (retrying in ${Math.round(retryInMs / 1000)}s)`
      );
    }
  })) {
    console.log(options.json ? JSON.stringify(event) : formatEvent(event));
  }
}
