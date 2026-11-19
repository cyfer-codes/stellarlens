const API_URL = process.env.API_URL ?? "http://localhost:3000";
const API_KEY = process.env.API_KEY ?? "";

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

export interface DecodedEventData {
  decoded?: {
    topic: unknown[];
    value: unknown;
  };
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

export interface EventsPage {
  data: EventRow[];
  nextCursor: number | null;
  prevCursor?: number | null;
}

export interface ListEventsParams {
  cursor?: number;
  limit?: number;
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

export class ApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly body: string;

  constructor(status: number, path: string, body: string) {
    super(`api request to ${path} failed with ${status}: ${body}`);
    this.name = "ApiError";
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

export class ApiNotFoundError extends ApiError {
  constructor(path: string, body = "not found") {
    super(404, path, body);
    this.name = "ApiNotFoundError";
  }
}

export interface SanitizedErrorResponse {
  status: number;
  message: string;
}

const STATUS_MESSAGE_MAP: Record<number, string> = {
  400: "Invalid request. Please verify your input.",
  401: "Unauthorized. Please check your credentials.",
  403: "Forbidden. You do not have permission to perform this action.",
  404: "The requested resource was not found.",
  409: "A conflict occurred with an existing resource.",
  422: "Unprocessable request data.",
  429: "Too many requests. Please try again later.",
  500: "An internal server error occurred in the upstream service.",
  502: "The upstream API service is currently unavailable.",
  503: "The upstream service is temporarily overloaded or down.",
  504: "The upstream service timed out."
};

/**
 * Sanitizes an API error or unexpected exception into user-facing status code and friendly message.
 * Internal paths, full URLs, stack traces, and backend error bodies are logged server-side only.
 */
export function sanitizeApiError(
  err: unknown,
  fallbackResource?: string
): SanitizedErrorResponse {
  // Always log the full unsanitized error server-side for observability and debugging
  console.error("Internal API error:", err);

  if (err instanceof ApiError) {
    if (err.status === 404 && fallbackResource) {
      return { status: 404, message: `${fallbackResource} not found` };
    }

    const mappedMessage = STATUS_MESSAGE_MAP[err.status];
    if (mappedMessage) {
      return {
        status: err.status >= 500 ? 502 : err.status,
        message: mappedMessage
      };
    }

    if (err.status >= 400 && err.status < 500) {
      return { status: err.status, message: "Client error. Please check your request." };
    }

    return {
      status: 502,
      message: "An upstream service error occurred. Please try again later."
    };
  }

  return {
    status: 502,
    message: "An unexpected error occurred while communicating with the server."
  };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "x-api-key": API_KEY,
      "Content-Type": "application/json",
      ...init?.headers
    },
    cache: "no-store"
  });

  if (response.status === 404) {
    const body = await response.text().catch(() => "not found");
    throw new ApiNotFoundError(path, body);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ApiError(response.status, path, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function listContracts(): Promise<Contract[]> {
  return apiFetch<{ data: Contract[] }>("/contracts").then((page) => page.data);
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

export function listEvents(contractId: number, params?: ListEventsParams): Promise<EventsPage> {
  const query = new URLSearchParams();
  if (params?.cursor !== undefined) {
    query.set("cursor", String(params.cursor));
  }
  if (params?.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  const qs = query.toString();
  return apiFetch<EventsPage>(`/contracts/${contractId}/events${qs ? `?${qs}` : ""}`);
}

export function listTransfers(contractId: number, params?: ListTransfersParams): Promise<TransfersPage> {
  const query = new URLSearchParams();
  if (params?.cursor !== undefined) {
    query.set("cursor", String(params.cursor));
  }
  if (params?.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  const qs = query.toString();
  return apiFetch<TransfersPage>(`/contracts/${contractId}/transfers${qs ? `?${qs}` : ""}`);
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
