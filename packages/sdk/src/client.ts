import { StellarLensApiError } from "./errors.js";
import type {
  Contract,
  ContractStats,
  EventRecord,
  GetStatsParams,
  ListContractsParams,
  ListEventsParams,
  ListTransfersParams,
  Page,
  RegisterContractInput,
  TransferRecord,
  WatchEventsOptions
} from "./types.js";

const DEFAULT_WATCH_INTERVAL_MS = 5000;
const DEFAULT_WATCH_MAX_BACKOFF_MS = 60_000;
const DEFAULT_WATCH_PAGE_SIZE = 100;

/** Resolves after `ms`, or immediately once `signal` aborts. Never rejects. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface StellarLensClientOptions {
  /** Base URL of the stellarlens api, e.g. "https://api.example.com" (no trailing slash needed). */
  baseUrl: string;
  /** A valid stellarlens api key. */
  apiKey: string;
  /** Override the fetch implementation (defaults to the global `fetch`). */
  fetch?: typeof fetch;
}

function buildQuery(params?: object): string {
  if (!params) {
    return "";
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export class StellarLensClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: StellarLensClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json",
        ...init?.headers
      }
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        // not JSON — keep the raw text as the error body
      }
      throw new StellarLensApiError(response.status, body);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  /** Registers a new contract, or updates the name/network of one already registered at that address. */
  registerContract(input: RegisterContractInput): Promise<Contract> {
    return this.request<Contract>("/contracts", {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  /** One cursor-paginated page of registered contracts, ordered by id. */
  listContracts(params?: ListContractsParams): Promise<Page<Contract>> {
    return this.request<Page<Contract>>(`/contracts${buildQuery(params)}`);
  }

  /**
   * Iterates every registered contract matching the filters, fetching pages lazily and following
   * `nextCursor` until it comes back `null`. Pass `cursor` to resume part-way through.
   */
  async *listAllContracts(params?: ListContractsParams): AsyncGenerator<Contract, void, undefined> {
    let cursor = params?.cursor;
    do {
      const page = await this.listContracts({ ...params, cursor });
      yield* page.data;
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
  }

  getContract(id: number): Promise<Contract> {
    return this.request<Contract>(`/contracts/${id}`);
  }

  /** Cursor-paginated events for a contract, oldest first. */
  listEvents(contractId: number, params?: ListEventsParams): Promise<Page<EventRecord>> {
    return this.request<Page<EventRecord>>(`/contracts/${contractId}/events${buildQuery(params)}`);
  }

  /**
   * Follows a contract's events as they're indexed, yielding each new event once, oldest first, until `signal`
   * aborts (the iterator then just finishes). Failed polls never end the watch: they're reported to `onError` and
   * retried with exponential backoff.
   *
   * ```ts
   * const controller = new AbortController();
   * for await (const event of client.watchEvents(contractId, { startAt: "latest", signal: controller.signal })) {
   *   console.log(event.id, event.decodedData?.decoded.topic);
   * }
   * ```
   */
  async *watchEvents(contractId: number, options: WatchEventsOptions = {}): AsyncGenerator<EventRecord, void, undefined> {
    const {
      intervalMs = DEFAULT_WATCH_INTERVAL_MS,
      maxBackoffMs = DEFAULT_WATCH_MAX_BACKOFF_MS,
      limit = DEFAULT_WATCH_PAGE_SIZE,
      signal,
      topic,
      onError
    } = options;
    const path = (cursor: number | undefined) =>
      `/contracts/${contractId}/events${buildQuery({ cursor, limit, topic })}`;

    let cursor = typeof options.startAt === "number" ? options.startAt : undefined;
    let resolveLatest = options.startAt === "latest";
    let failures = 0;

    while (!signal?.aborted) {
      let page: Page<EventRecord>;
      try {
        if (resolveLatest) {
          // The api is oldest-first only, so "latest" means walking to the last page once and starting after it.
          let next: number | undefined = cursor;
          do {
            const skipped: Page<EventRecord> = await this.request<Page<EventRecord>>(path(next), { signal });
            if (skipped.data.length > 0) {
              cursor = skipped.data[skipped.data.length - 1].id;
            }
            next = skipped.nextCursor ?? undefined;
          } while (next !== undefined && !signal?.aborted);
          resolveLatest = false;
          failures = 0;
          await sleep(intervalMs, signal);
          continue;
        }
        page = await this.request<Page<EventRecord>>(path(cursor), { signal });
        failures = 0;
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        failures += 1;
        const retryInMs = Math.min(intervalMs * 2 ** failures, maxBackoffMs);
        onError?.(error, { attempt: failures, retryInMs });
        await sleep(retryInMs, signal);
        continue;
      }

      for (const event of page.data) {
        if (signal?.aborted) {
          return;
        }
        yield event;
        // Advance to the last *returned* id, not nextCursor: the api only sets nextCursor when a page overflows
        // `limit`, so following it would reset to the start once caught up and replay everything.
        cursor = event.id;
      }

      // A full page means more are already waiting — fetch them now rather than after the interval.
      if (page.nextCursor === null) {
        await sleep(intervalMs, signal);
      }
    }
  }

  /** Cursor-paginated token transfers for a contract, oldest first. */
  listTransfers(contractId: number, params?: ListTransfersParams): Promise<Page<TransferRecord>> {
    return this.request<Page<TransferRecord>>(`/contracts/${contractId}/transfers${buildQuery(params)}`);
  }

  /** Transfer summary stats for a contract, optionally scoped to a time window. */
  getStats(contractId: number, params?: GetStatsParams): Promise<ContractStats> {
    return this.request<ContractStats>(`/contracts/${contractId}/stats${buildQuery(params)}`);
  }
}
