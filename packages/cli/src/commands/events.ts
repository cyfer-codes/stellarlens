import type { EventRecord, StellarLensClient } from "@stellarlens/sdk";

export const POLL_INTERVAL_MS = 5000;
/** Upper bound for the delay between polls while requests keep failing. */
export const MAX_BACKOFF_MS = 60_000;
const PAGE_SIZE = 100;

export interface TailOptions {
  /** Start after this event id cursor, or from the first event indexed at/after this ISO 8601 date. */
  since?: string;
  /** Replay every event from the beginning of history. */
  fromStart?: boolean;
}

export interface TailDeps {
  /** Waits between polls; injectable for tests. Should resolve early when `signal` aborts. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Stops the tail loop when aborted. */
  signal?: AbortSignal;
}

export type SinceValue = { kind: "cursor"; cursor: number } | { kind: "date"; date: Date };

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
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
}

/** The api's `cursor` must be >= 1; "before the first event" is expressed by omitting it. */
function cursorBefore(id: number): number | undefined {
  return id > 1 ? id - 1 : undefined;
}

/**
 * Parses a `--since` value: a non-negative integer is an event id cursor (tail starts *after* that event),
 * anything else must be an ISO 8601 date/time.
 */
export function parseSince(value: string): SinceValue {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return { kind: "cursor", cursor: Number(trimmed) };
  }
  const date = new Date(trimmed);
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed) && !Number.isNaN(date.getTime())) {
    return { kind: "date", date };
  }
  throw new Error(
    `--since must be an event id cursor (e.g. 1234) or an ISO 8601 date (e.g. 2026-01-01T00:00:00Z), got "${value}"`
  );
}

/** The id of the newest event for the contract, or `undefined` if it has none yet. */
export async function fetchLatestCursor(client: StellarLensClient, contractId: number): Promise<number | undefined> {
  const page = await client.listEvents(contractId, { order: "desc", limit: 1 });
  return page.data[0]?.id;
}

/**
 * Works out the cursor the first poll should use:
 * - default: the latest existing event, so only events that arrive from now on are shown;
 * - `fromStart`: no cursor, replaying all history;
 * - `since` cursor: that cursor as-is;
 * - `since` date: just before the first event indexed at/after that date, or the latest event if none is.
 */
export async function resolveStartCursor(
  client: StellarLensClient,
  contractId: number,
  options: TailOptions = {}
): Promise<number | undefined> {
  if (options.fromStart && options.since !== undefined) {
    throw new Error("--since and --from-start can't be used together");
  }
  if (options.fromStart) {
    return undefined;
  }
  if (options.since === undefined) {
    return fetchLatestCursor(client, contractId);
  }

  const since = parseSince(options.since);
  if (since.kind === "cursor") {
    return since.cursor > 0 ? since.cursor : undefined;
  }

  // Read the latest cursor *before* searching from the date, so an event indexed between the two requests
  // is found by the date search rather than skipped.
  const latest = await fetchLatestCursor(client, contractId);
  const page = await client.listEvents(contractId, { from: since.date.toISOString(), limit: 1 });
  const first = page.data[0];
  return first ? cursorBefore(first.id) : latest;
}

/**
 * Prints a contract's events as they arrive, until `signal` aborts. Polling, cursor tracking and error backoff all
 * live in the SDK's `watchEvents`.
 */
export async function tailEvents(
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

/** Delay before the next poll: the normal interval, doubling per consecutive failure up to {@link MAX_BACKOFF_MS}. */
export function nextPollDelay(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) {
    return POLL_INTERVAL_MS;
  }
  return Math.min(POLL_INTERVAL_MS * 2 ** consecutiveFailures, MAX_BACKOFF_MS);
}

function describeStart(options: TailOptions): string {
  if (options.fromStart) {
    return "from the first event";
  }
  if (options.since !== undefined) {
    return `since ${options.since}`;
  }
  return "from now";
}

export async function tailEvents(
  client: StellarLensClient,
  contractId: number,
  options: TailOptions = {},
  deps: TailDeps = {}
): Promise<void> {
  // Validate flags up front so a typo fails immediately instead of being retried forever.
  if (options.fromStart && options.since !== undefined) {
    throw new Error("--since and --from-start can't be used together");
  }
  if (options.since !== undefined) {
    parseSince(options.since);
  }

  const wait = deps.sleep ?? sleep;
  const { signal } = deps;

  console.log(`tailing events for contract ${contractId} ${describeStart(options)} (ctrl+c to stop)...`);

  let started = false;
  let cursor: number | undefined;
  let consecutiveFailures = 0;

  while (!signal?.aborted) {
    try {
      if (!started) {
        cursor = await resolveStartCursor(client, contractId, options);
        started = true;
      }
      cursor = await pollNewEvents(client, contractId, cursor);
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      const retryInSeconds = nextPollDelay(consecutiveFailures) / 1000;
      console.error(
        `failed to fetch events (${consecutiveFailures} in a row, retrying in ${retryInSeconds}s):`,
        err instanceof Error ? err.message : err
      );
    }
    await wait(nextPollDelay(consecutiveFailures), signal);
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
    console.log(formatEvent(event));
  }
}
