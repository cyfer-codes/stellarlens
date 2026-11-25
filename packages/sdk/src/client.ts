import { StellarLensApiError, StellarLensHookError, StellarLensTimeoutError } from "./errors.js";
import type {
  ApiKey,
  BulkRegisterContractItem,
  BulkRegisterContractsResponse,
  Contract,
  ContractStats,
  CreateWebhookInput,
  EventRecord,
  GetStatsParams,
  HealthStatus,
  ListContractsParams,
  ListEventsParams,
  ListTransfersParams,
  Page,
  RegisterContractInput,
  RequestOptions,
  TransferRecord,
  WatchEventsOptions,
  Webhook,
  WebhookSummary
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
}

const DEFAULT_WATCH_INTERVAL_MS = 5000;
const DEFAULT_WATCH_MAX_BACKOFF_MS = 60_000;
const DEFAULT_WATCH_PAGE_SIZE = 100;
const MIN_PAGE_LIMIT = 1;
const MAX_PAGE_LIMIT = 100;
/** Default per-request timeout; see {@link StellarLensClientOptions.timeoutMs}. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** `0` (disabled), a positive finite number, or `Infinity` (also disabled). */
function assertValidTimeout(timeoutMs: number): void {
  if (typeof timeoutMs !== "number" || Number.isNaN(timeoutMs) || timeoutMs < 0) {
    throw new RangeError(`timeoutMs must be a non-negative number, or 0 to disable (got ${String(timeoutMs)})`);
  }
}

/**
 * Settles with `promise`, or rejects with `signal.reason` as soon as `signal` aborts — so an abort or timeout
 * takes effect even with a custom `fetch` that ignores its signal.
 */
function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    // The underlying promise may still settle later; make sure that can't surface as an unhandled rejection.
    promise.catch(() => {});
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

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
   * Milliseconds a request may take, from sending it to reading the full response body, before it's aborted and
   * the call rejects with a {@link StellarLensTimeoutError}. Defaults to {@link DEFAULT_TIMEOUT_MS} (10000). Pass
   * `0` (or `Infinity`) to disable. Individual calls can override it with `RequestOptions.timeoutMs`.
   */
  timeoutMs?: number;
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
    // Array filters (e.g. `topics`) are sent as repeated params (`topics=a&topics=b`).
    if (Array.isArray(value)) {
      for (const item of value) {
        search.append(key, String(item));
      }
      continue;
    }
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** Rejects page sizes the api would reject, before a request is sent. */
function assertValidLimit(limit: number | undefined): void {
  if (limit === undefined) {
    return;
  }
  if (!Number.isInteger(limit) || limit < MIN_PAGE_LIMIT || limit > MAX_PAGE_LIMIT) {
    throw new RangeError(
      `limit must be an integer between ${MIN_PAGE_LIMIT} and ${MAX_PAGE_LIMIT} (got ${String(limit)})`
    );
  }
}

export class StellarLensClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly onRequest: StellarLensClientOptions["onRequest"];
  private readonly onResponse: StellarLensClientOptions["onResponse"];
  private readonly timeoutMs: number;

  constructor(options: StellarLensClientOptions) {
    const rawBaseUrl = options.baseUrl;
    let parsedBaseUrl: URL;
    try {
      parsedBaseUrl = new URL(rawBaseUrl);
    } catch {
      throw new TypeError(`Invalid baseUrl: ${JSON.stringify(rawBaseUrl)}. Expected a valid absolute URL.`);
    }
    // A relative URL or a non-http scheme can be parsed but cannot be used as an API base URL.
    if (!["http:", "https:"].includes(parsedBaseUrl.protocol) || !parsedBaseUrl.hostname) {
      throw new TypeError(`Invalid baseUrl: ${JSON.stringify(rawBaseUrl)}. Expected an http(s) URL.`);
    }
    this.baseUrl = rawBaseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.onRequest = options.onRequest;
    this.onResponse = options.onResponse;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    assertValidTimeout(this.timeoutMs);
  }

  /**
   * Sends one request. `options.signal` (or a `signal` on `init`, or one an `onRequest` hook sets) cancels it, and
   * the effective `timeoutMs` bounds it; both share a single internal `AbortController` that `fetch` receives.
   */
  private async request<T>(path: string, init?: RequestInit, options?: RequestOptions): Promise<T> {
    if (options?.timeoutMs !== undefined) {
      assertValidTimeout(options.timeoutMs);
    }
    // A pre-aborted signal sends nothing and runs no hooks.
    options?.signal?.throwIfAborted();

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

    const { url, signal: initSignal, ...fetchInit } = requestInit;
    const method = requestInit.method;
    const callerSignal = options?.signal ?? initSignal ?? undefined;
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    const hasTimeout = timeoutMs > 0 && Number.isFinite(timeoutMs);

    // An async onRequest hook gives the caller's signal time to abort; don't send in that case either.
    callerSignal?.throwIfAborted();

    // No signal and no timeout: call fetch exactly as before, without an AbortController.
    if (!callerSignal && !hasTimeout) {
      return this.send<T>(url, method, fetchInit, undefined);
    }

    const controller = new AbortController();
    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    const timer = hasTimeout
      ? setTimeout(() => controller.abort(new StellarLensTimeoutError(method, url, timeoutMs)), timeoutMs)
      : undefined;

    try {
      return await this.send<T>(url, method, { ...fetchInit, signal: controller.signal }, controller.signal);
    } catch (err) {
      // However a custom fetch reports the abort, a timeout always surfaces as StellarLensTimeoutError.
      const reason: unknown = controller.signal.reason;
      if (controller.signal.aborted && reason instanceof StellarLensTimeoutError) {
        throw reason;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  }

  /** Performs the fetch, runs `onResponse`, and reads the body — all of it cut short if `signal` aborts. */
  private async send<T>(
    url: string,
    method: string,
    fetchInit: RequestInit,
    signal: AbortSignal | undefined
  ): Promise<T> {
    const startedAt = performance.now();
    const response = await abortable(this.fetchImpl(url, fetchInit), signal);
    const durationMs = performance.now() - startedAt;

    if (this.onResponse) {
      try {
        await this.onResponse({ url, method, response, durationMs });
      } catch (err) {
        throw new StellarLensHookError("onResponse", method, url, err);
      }
    }

    if (!response.ok) {
      const text = await abortable(response.text(), signal).catch(() => "");
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

    return (await abortable(response.json(), signal)) as T;
  }

  /**
   * Calls `GET /health` and resolves once the api answers — the quickest check that `baseUrl` points at a live
   * stellarlens api. Rejects with a {@link StellarLensApiError} on a non-2xx response.
   */
  ping(): Promise<HealthStatus> {
    return this.request<HealthStatus>("/health");
  }

  /** Registers a new contract, or updates the name/network of one already registered at that address. */
   * Walks a cursor-paginated endpoint, yielding each record in order and fetching the next page only once the
   * current one is consumed. Stops when `nextCursor` is `null`/absent, or when the api hands back the cursor it was
   * just given (which would otherwise refetch the same page forever).
   */
  private async *paginate<T>(
    startCursor: number | undefined,
    fetchPage: (cursor: number | undefined) => Promise<Page<T>>
  ): AsyncGenerator<T, void, undefined> {
    let cursor = startCursor;
    while (true) {
      const page = await fetchPage(cursor);
      yield* page.data;
      const next = page.nextCursor ?? undefined;
      if (next === undefined || next === cursor) {
        return;
      }
      cursor = next;
    }
  }

  /** Registers a new contract. Throws StellarLensApiError (409) with existingId when the address is already registered; use PATCH to update it. */
  registerContract(input: RegisterContractInput): Promise<Contract> {
    return this.request<Contract>("/contracts", {
      method: "POST",
      body: JSON.stringify(input)
    });
  /** Registers a new contract, or updates the name/network of one already registered at that address. */
  registerContract(input: RegisterContractInput, options?: RequestOptions): Promise<Contract> {
    return this.request<Contract>(
      "/contracts",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      options
    );
  }

  /** Cursor-paginated registered contracts, ordered by id. Filter with `name` (substring) and `network`. */
  async listContracts(params?: ListContractsParams, options?: RequestOptions): Promise<Page<Contract>> {
    assertValidLimit(params?.limit);
    return this.request<Page<Contract>>(`/contracts${buildQuery(params)}`, undefined, options);
  }

  /**
   * Registers up to 100 contracts in one request (`POST /contracts/bulk`), reporting a result per
   * item. Unlike `registerContract`, already-registered addresses are left untouched (`existing`).
   */
  registerContractsBulk(
    items: BulkRegisterContractItem[],
    options?: RequestOptions
  ): Promise<BulkRegisterContractsResponse> {
    return this.request<BulkRegisterContractsResponse>(
      "/contracts/bulk",
      {
        method: "POST",
        body: JSON.stringify({ items })
      },
      options
    );
  }

  /**
   * Iterates every registered contract matching the filters, fetching pages lazily and following
   * `nextCursor` until it comes back `null`. Pass `cursor` to resume part-way through. `options` (signal,
   * timeout) apply to each page request.
   */
  listAllContracts(params?: ListContractsParams, options?: RequestOptions): AsyncGenerator<Contract, void, undefined> {
    return this.paginate(params?.cursor, (cursor) => this.listContracts({ ...params, cursor }, options));
  }

  getContract(id: number, options?: RequestOptions): Promise<Contract> {
    return this.request<Contract>(`/contracts/${id}`, undefined, options);
  }

  /**
   * Deletes a registered contract (`DELETE /contracts/:id`). Resolves once the api answers `204 No Content`;
   * any error status — e.g. `404` for an unknown id — rejects with a {@link StellarLensApiError}.
   */
  async deleteContract(id: number, options?: RequestOptions): Promise<void> {
    await this.request<void>(`/contracts/${id}`, { method: "DELETE" }, options);
  }

  /**
   * Cursor-paginated events for a contract, oldest first. Pass `order: "desc"` to page newest-first instead
   * (`{ order: "desc", limit: 1 }` returns the latest event).
   */
  async listEvents(
    contractId: number,
    params?: ListEventsParams,
    options?: RequestOptions
  ): Promise<Page<EventRecord>> {
    assertValidLimit(params?.limit);
    return this.request<Page<EventRecord>>(
      `/contracts/${contractId}/events${buildQuery(params)}`,
      undefined,
      options
    );
  }

  /**
   * Iterates every event for a contract matching the filters (in `params.order`, oldest first by default),
   * fetching pages lazily and following `nextCursor` until it comes back `null`. Pass `cursor` to resume.
   *
   * ```ts
   * for await (const event of client.listAllEvents(contractId, { topic: "transfer" })) {
   *   console.log(event.id);
   * }
   * ```
   */
  listAllEvents(
    contractId: number,
    params?: ListEventsParams,
    options?: RequestOptions
  ): AsyncGenerator<EventRecord, void, undefined> {
    return this.paginate(params?.cursor, (cursor) => this.listEvents(contractId, { ...params, cursor }, options));
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
    assertValidLimit(limit);
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
            const skipped: Page<EventRecord> = await this.request<Page<EventRecord>>(path(next), undefined, { signal });
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
        page = await this.request<Page<EventRecord>>(path(cursor), undefined, { signal });
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
  async listTransfers(
    contractId: number,
    params?: ListTransfersParams,
    options?: RequestOptions
  ): Promise<Page<TransferRecord>> {
    assertValidLimit(params?.limit);
    return this.request<Page<TransferRecord>>(
      `/contracts/${contractId}/transfers${buildQuery(params)}`,
      undefined,
      options
    );
  }

  /**
   * Iterates every token transfer for a contract matching the filters, oldest first, fetching pages lazily and
   * following `nextCursor` until it comes back `null`. Pass `cursor` to resume part-way through.
   */
  listAllTransfers(
    contractId: number,
    params?: ListTransfersParams,
    options?: RequestOptions
  ): AsyncGenerator<TransferRecord, void, undefined> {
    return this.paginate(params?.cursor, (cursor) =>
      this.listTransfers(contractId, { ...params, cursor }, options)
    );
  }

  /** Transfer summary stats for a contract, optionally scoped to a time window. */
  getStats(contractId: number, params?: GetStatsParams, options?: RequestOptions): Promise<ContractStats> {
    return this.request<ContractStats>(`/contracts/${contractId}/stats${buildQuery(params)}`, undefined, options);
  }

  /**
   * Registers a webhook for a contract. The response includes the signing `secret`, which is only returned
   * here (and on secret rotation) — store it, it can't be fetched again.
   */
  registerWebhook(contractId: number, input: CreateWebhookInput): Promise<Webhook> {
    return this.request<Webhook>(`/contracts/${contractId}/webhooks`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  /** Every webhook registered for a contract (without their secrets). */
  listWebhooks(contractId: number): Promise<WebhookSummary[]> {
    return this.request<WebhookSummary[]>(`/contracts/${contractId}/webhooks`);
  }

  /** Deletes a webhook from a contract. Resolves once the api confirms (`204 No Content`). */
  removeWebhook(contractId: number, id: number): Promise<void> {
    return this.request<void>(`/contracts/${contractId}/webhooks/${id}`, { method: "DELETE" });
  }

  /** Lists every api key (`GET /api-keys`). The raw key value is never returned, only its metadata. */
  listApiKeys(options?: RequestOptions): Promise<ApiKey[]> {
    return this.request<ApiKey[]>("/api-keys", undefined, options);
  }

  /**
   * Revokes an api key (`DELETE /api-keys/:id`). Resolves once the api answers `204 No Content`;
   * idempotent, so revoking an already-revoked key succeeds.
   */
  revokeApiKey(id: number, options?: RequestOptions): Promise<void> {
    return this.request<void>(`/api-keys/${id}`, { method: "DELETE" }, options);
  }
}
