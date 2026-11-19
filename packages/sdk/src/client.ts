import { StellarLensApiError, StellarLensHookError } from "./errors.js";
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

/**
 * The request about to be sent, as passed to {@link StellarLensClientOptions.onRequest}. `headers` is always a
 * plain object (already including `x-api-key` and `Content-Type`), so hooks can read and add to it directly.
 */
export interface StellarLensRequestInit extends RequestInit {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/** What {@link StellarLensClientOptions.onResponse} receives once response headers arrive. */
export interface StellarLensResponseInfo {
  url: string;
  method: string;
  /**
   * The raw response, for every status (including 4xx/5xx). The client still needs to read its body, so a
   * hook that wants the body must read `response.clone()` rather than `response` itself.
   */
  response: Response;
  /** Milliseconds from just before `fetch` was called until the response headers arrived. */
  durationMs: number;
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
  /**
   * Called before every request — use it to add tracing headers or log outgoing calls. Mutate `init` (e.g.
   * `init.headers["traceparent"] = ...`) or return a replacement; may be async. If it throws, the request is
   * not sent and the call rejects with a {@link StellarLensHookError}.
   */
  onRequest?: (
    init: StellarLensRequestInit
  ) => void | StellarLensRequestInit | Promise<void | StellarLensRequestInit>;
  /**
   * Called after every response arrives (before error handling, so failed requests are reported too) — use it
   * for logging and metrics. May be async. If it throws, the call rejects with a {@link StellarLensHookError}.
   * Not called when `fetch` itself rejects (e.g. a network error).
   */
  onResponse?: (info: StellarLensResponseInfo) => void | Promise<void>;
}

function buildQuery(params?: object): string {
  if (!params) {
    return "";
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }
    // Array filters (e.g. `topics`) are sent comma-separated, which the api splits back apart.
    search.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export class StellarLensClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly onRequest: StellarLensClientOptions["onRequest"];
  private readonly onResponse: StellarLensClientOptions["onResponse"];

  constructor(options: StellarLensClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.onRequest = options.onRequest;
    this.onResponse = options.onResponse;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let requestInit: StellarLensRequestInit = {
      ...init,
      url: `${this.baseUrl}${path}`,
      method: init?.method ?? "GET",
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json",
        ...(init?.headers as Record<string, string> | undefined)
      }
    };

    if (this.onRequest) {
      try {
        requestInit = (await this.onRequest(requestInit)) ?? requestInit;
      } catch (err) {
        throw new StellarLensHookError("onRequest", requestInit.method, requestInit.url, err);
      }
    }

    const { url, ...fetchInit } = requestInit;
    const startedAt = performance.now();
    const response = await this.fetchImpl(url, fetchInit);
    const durationMs = performance.now() - startedAt;

    if (this.onResponse) {
      try {
        await this.onResponse({ url, method: requestInit.method, response, durationMs });
      } catch (err) {
        throw new StellarLensHookError("onResponse", requestInit.method, url, err);
      }
    }

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

  /** Cursor-paginated registered contracts, ordered by id. Filter with `name` (substring) and `network`. */
  listContracts(params?: ListContractsParams): Promise<Page<Contract>> {
    return this.request<Page<Contract>>(`/contracts${buildQuery(params)}`);
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

  /**
   * Cursor-paginated events for a contract, oldest first. Pass `order: "desc"` to page newest-first instead
   * (`{ order: "desc", limit: 1 }` returns the latest event).
   */
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
