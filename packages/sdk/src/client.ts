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
  TransferRecord
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

  /** Cursor-paginated token transfers for a contract, oldest first. */
  listTransfers(contractId: number, params?: ListTransfersParams): Promise<Page<TransferRecord>> {
    return this.request<Page<TransferRecord>>(`/contracts/${contractId}/transfers${buildQuery(params)}`);
  }

  /** Transfer summary stats for a contract, optionally scoped to a time window. */
  getStats(contractId: number, params?: GetStatsParams): Promise<ContractStats> {
    return this.request<ContractStats>(`/contracts/${contractId}/stats${buildQuery(params)}`);
  }
}
