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
}

export interface ListTransfersParams {
  cursor?: number;
  limit?: number;
}

export class ApiNotFoundError extends Error {}

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
    throw new ApiNotFoundError(`not found: ${path}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`api request to ${path} failed with ${response.status}: ${body}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function listContracts(): Promise<Contract[]> {
  return apiFetch<Contract[]>("/contracts");
}

export function getContract(id: number): Promise<Contract> {
  return apiFetch<Contract>(`/contracts/${id}`);
}

export function createContract(input: CreateContractInput): Promise<Contract> {
  return apiFetch<Contract>("/contracts", {
    method: "POST",
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
