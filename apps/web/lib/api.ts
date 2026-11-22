const API_URL = process.env.API_URL ?? "http://localhost:3000";
const API_KEY = process.env.API_KEY ?? "";
// Falls back to the full-scope key when unset, so this stays optional.
const API_READ_KEY = process.env.API_READ_KEY || API_KEY;

/**
 * Every GET we proxy — including all unauthenticated PUBLIC_DEMO traffic,
 * which the middleware only ever lets through for GETs — uses the
 * read-scoped key. Mutating requests (POST/PATCH/DELETE) always require a
 * session and use the full key.
 */
function apiKeyFor(method: string): string {
  return method === "GET" ? API_READ_KEY : API_KEY;
}

export interface Contract {
  id: number;
  address: string;
  name: string | null;
  network: string;
}

export interface CreateContractInput {
  address: string;
  network: string;
  name?: string;
}

export interface UpdateContractInput {
  name?: string | null;
}

export interface ContractStats {
  transferCount: number;
  uniqueSenders: number;
  uniqueReceivers: number;
  volumeByAsset: { asset: string; volume: string }[];
}

export interface ContractStatus {
  status: "live" | "behind" | "not_indexed";
  lag: number | null;
  latestLedger?: number | null;
  indexedLedger?: number | null;
  updatedAt?: string;
}

export interface DecodedEventData {
  raw?: { topic?: string[]; value?: string };
  decoded?: {
    topic: unknown[];
    value: unknown;
  };
  decodeErrors?: { field: string; error: string }[];
}

export interface EventRow {
  id: number;
  contractId: number;
  ledger: number;
  txHash: string;
  topic: string;
  decodedData: DecodedEventData | null;
  createdAt: string;
}

export interface RecentEventRow extends EventRow {
  contractName: string | null;
}

export interface EventsPage {
  data: EventRow[];
  nextCursor: number | null;
  prevCursor?: number | null;
}

export interface ListEventsParams {
  cursor?: number;
  limit?: number;
  topic?: string;
  topics?: string[];
  from?: string;
  to?: string;
}

export interface TransferRow {
  id: number;
  contractId: number;
  from: string;
  to: string;
  amount: string;
  asset: string;
  txHash: string;
  ledger: number;
  createdAt: string;
}

export interface TransfersPage {
  data: TransferRow[];
  nextCursor: number | null;
  prevCursor?: number | null;
}

export interface ListTransfersParams {
  cursor?: number;
  limit?: number;
  asset?: string;
  from?: string;
  to?: string;
  minAmount?: string;
  maxAmount?: string;
}

export interface Webhook {
  id: number;
  url: string;
  eventTypes: string[] | null;
  createdAt: string;
}

export interface CreatedWebhook extends Webhook {
  secret: string;
}

export interface CreateWebhookInput {
  url: string;
  eventTypes?: string[];
}

/** Thrown for any non-2xx response from the api. `status` is the upstream status code. */
export class ApiProxyError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class ApiNotFoundError extends ApiProxyError {
  constructor(path: string) {
    super(404, `not found: ${path}`);
  }
}
export class ApiNotFoundError extends Error { }
export class ApiConflictError extends Error {}
export class ApiBadRequestError extends Error {}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "x-api-key": apiKeyFor(method),
      "Content-Type": "application/json",
      ...init?.headers
    },
    cache: "no-store"
  });

  if (response.status === 404) {
    throw new ApiNotFoundError(path);
  }

    if (response.status === 409) {
    const body = await response.text();
    throw new ApiConflictError(body || "conflict");
  }

  if (response.status === 400) {
    const body = await response.text();
    throw new ApiBadRequestError(body || "bad request");
  }

  if (!response.ok) {
    const body = await response.text();
    // Full internal detail (path, upstream status and body) is logged here,
    // server-side only. Callers get ApiProxyError.status to map to a
    // sanitized, user-facing message — never this message itself.
    console.error(`api request to ${path} failed with ${response.status}: ${body}`);
    let parsedBody: unknown = body;
    try {
      parsedBody = body ? JSON.parse(body) : undefined;
    } catch {
      // Keep non-JSON response bodies available to callers as text.
    }
    throw new ApiProxyError(
      response.status,
      `api request to ${path} failed with ${response.status}`,
      parsedBody
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export interface ContractsPage {
  data: Contract[];
  nextCursor: number | null;
}

export interface ListContractsParams {
  cursor?: number;
  limit?: number;
  name?: string;
  network?: string;
}

export function listContracts(params?: ListContractsParams): Promise<ContractsPage> {
  const query = new URLSearchParams();
  if (params?.cursor !== undefined) {
    query.set("cursor", String(params.cursor));
  }
  if (params?.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  if (params?.name) {
    query.set("name", params.name);
  }
  if (params?.network) {
    query.set("network", params.network);
  }
  const qs = query.toString();
  return apiFetch<ContractsPage>(`/contracts${qs ? `?${qs}` : ""}`);
}

export function getContract(id: number): Promise<Contract> {
  return apiFetch<Contract>(`/contracts/${id}`);
}

export function createContract(input: CreateContractInput): Promise<Contract> {
  return apiFetch<Contract>(`/contracts`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateContract(id: number, input: UpdateContractInput): Promise<Contract> {
  return apiFetch<Contract>(`/contracts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function getContractStats(id: number): Promise<ContractStats> {
  return apiFetch<ContractStats>(`/contracts/${id}/stats`);
}

export function getContractStatus(id: number): Promise<ContractStatus> {
  return apiFetch<ContractStatus>(`/contracts/${id}/status`);
}

export function listEvents(contractId: number, params?: ListEventsParams): Promise<EventsPage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== "") {
      query.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
  }
  const qs = query.toString();
  return apiFetch<EventsPage>(`/contracts/${contractId}/events${qs ? `?${qs}` : ""}`);
}

export function listRecentEvents(limit = 20): Promise<RecentEventRow[]> {
  return apiFetch<RecentEventRow[]>(`/events?limit=${limit}`);
}

// Page sizes the transfers table offers; `limit` below is sent to the api as-is. The URL/pagination helpers live
// in a module without server env access so client components can import them too.
export {
  DEFAULT_TRANSFER_PAGE_SIZE,
  TRANSFER_PAGE_SIZES,
  type TransferPageSize
} from "./transfersPagination";

export function listTransfers(contractId: number, params?: ListTransfersParams): Promise<TransfersPage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  }
  const qs = query.toString();
  return apiFetch<TransfersPage>(`/contracts/${contractId}/transfers${qs ? `?${qs}` : ""}`);
}

export function listAccountTransfers(address: string, params?: ListTransfersParams): Promise<TransfersPage> {
  const query = new URLSearchParams({ address });
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  }
  return apiFetch<TransfersPage>(`/transfers?${query}`);
}

export function listWebhooks(contractId: number): Promise<Webhook[]> {
  return apiFetch<Webhook[]>(`/contracts/${contractId}/webhooks`);
}

export function createWebhook(contractId: number, input: CreateWebhookInput): Promise<CreatedWebhook> {
  return apiFetch<CreatedWebhook>(`/contracts/${contractId}/webhooks`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function deleteWebhook(contractId: number, id: number): Promise<void> {
  return apiFetch<void>(`/contracts/${contractId}/webhooks/${id}`, { method: "DELETE" });
}

export interface UpdateWebhookInput {
  url?: string;
  eventTypes?: string[];
}

export function updateWebhook(contractId: number, id: number, input: UpdateWebhookInput): Promise<Webhook> {
  return apiFetch<Webhook>(`/contracts/${contractId}/webhooks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export interface RotatedWebhook {
  id: number;
  contractId: number;
  url: string;
  eventTypes: string[] | null;
  secret: string;
  createdAt: string;
}

export function rotateWebhookSecret(contractId: number, id: number): Promise<RotatedWebhook> {
  return apiFetch<RotatedWebhook>(`/contracts/${contractId}/webhooks/${id}/rotate-secret`, {
    method: "POST"
  });
}

export interface WebhookDelivery {
  id: number;
  status: string;
  attempts: number;
  lastError: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface WebhookDeliveriesPage {
  data: WebhookDelivery[];
  nextCursor: number | null;
}

export interface ListWebhookDeliveriesParams {
  cursor?: number;
  limit?: number;
}

export function listWebhookDeliveries(
  contractId: number,
  webhookId: number,
  params?: ListWebhookDeliveriesParams
): Promise<WebhookDeliveriesPage> {
  const query = new URLSearchParams();
  if (params?.cursor !== undefined) {
    query.set("cursor", String(params.cursor));
  }
  if (params?.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  const qs = query.toString();
  return apiFetch<WebhookDeliveriesPage>(
    `/contracts/${contractId}/webhooks/${webhookId}/deliveries${qs ? `?${qs}` : ""}`
  );
}
