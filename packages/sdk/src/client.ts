import { StellarLensApiError } from "./errors.js";
import type {
  Contract,
  ContractStats,
  EventRecord,
  GetStatsParams,
  ListEventsParams,
  ListTransfersParams,
  Page,
  RegisterContractInput,
  TransferRecord
} from "./types.js";

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

  listContracts(): Promise<Contract[]> {
    return this.request<Contract[]>("/contracts");
  }

  getContract(id: number): Promise<Contract> {
    return this.request<Contract>(`/contracts/${id}`);
  }

  /** Cursor-paginated events for a contract, oldest first. */
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
