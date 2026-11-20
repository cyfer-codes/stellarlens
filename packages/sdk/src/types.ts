/**
 * Public request/response types for the SDK.
 *
 * Every type here is derived from `./generated/openapi.ts`, which `pnpm generate` produces from the committed
 * OpenAPI spec (`apps/api/openapi.json`). Don't hand-write shapes in this file — change the spec and
 * regenerate, so the SDK can't drift from the api again. CI fails if the generated file is stale.
 */
import type { components, operations } from "./generated/openapi.js";

type Schemas = components["schemas"];
type QueryOf<Op extends keyof operations> = NonNullable<operations[Op]["parameters"]["query"]>;

export type ApiError = Schemas["ApiError"];

export type Contract = Schemas["Contract"];
export type RegisterContractInput = Schemas["RegisterContractInput"];
export type UpdateContractInput = Schemas["UpdateContractInput"];
export type BulkRegisterContractsInput = Schemas["BulkRegisterContractsInput"];
export type BulkRegisterContractResult = Schemas["BulkRegisterContractResult"];
export type BulkRegisterContractsResponse = Schemas["BulkRegisterContractsResponse"];
export type ListContractsParams = QueryOf<"listContracts">;

export type DecodedEventData = Schemas["DecodedEventData"];
export type EventRecord = Schemas["EventRecord"];
export type ListEventsParams = QueryOf<"listEvents">;

export type TransferRecord = Schemas["TransferRecord"];
export type ListTransfersParams = QueryOf<"listTransfers">;

export type GetStatsParams = QueryOf<"getStats">;
export type ContractStats = Schemas["ContractStats"];

export type ApiKeyScope = Schemas["ApiKeyScope"];
export type ApiKey = Schemas["ApiKey"];
export type CreateApiKeyInput = Schemas["CreateApiKeyInput"];
export type CreatedApiKey = Schemas["CreatedApiKey"];

export type Webhook = Schemas["Webhook"];
export type WebhookSummary = Schemas["WebhookSummary"];
export type UpdatedWebhook = Schemas["UpdatedWebhook"];
export type CreateWebhookInput = Schemas["CreateWebhookInput"];
export type UpdateWebhookInput = Schemas["UpdateWebhookInput"];
export type WebhookDelivery = Schemas["WebhookDelivery"];

/** A cursor-paginated response. Pass `nextCursor` back as `cursor` until it comes back `null`. */
export interface Page<T> {
  data: T[];
  nextCursor: number | null;
}

// Compile-time guard: the generic `Page<T>` must stay assignable from every generated page schema.
type AssertPage<P extends Page<unknown>> = P;
export type _GeneratedPagesMatch = [
  AssertPage<Schemas["ContractPage"]>,
  AssertPage<Schemas["EventPage"]>,
  AssertPage<Schemas["TransferPage"]>,
  AssertPage<Schemas["WebhookDeliveryPage"]>
];
export interface Contract {
  id: number;
  address: string;
  name: string | null;
  network: string;
}

export interface ListContractsParams {
  /** Return contracts with an id greater than this (pass the previous page's `nextCursor`). */
  cursor?: number;
  /** Page size, 1–100 (api default 20). */
  limit?: number;
  /** Case-insensitive substring match on the contract name. */
  name?: string;
  /** Exact match on network, e.g. "testnet". */
  network?: string;
}

export interface RegisterContractInput {
  address: string;
  network: string;
  name?: string;
}

export interface ListContractsParams {
  cursor?: number;
  limit?: number;
  /** Case-insensitive substring match on the contract name. */
  name?: string;
  network?: string;
export interface BulkRegisterContractItem {
  address: string;
  network: string;
  name?: string;
}

export type BulkContractStatus = "created" | "existing" | "error";

/** One entry of a bulk registration response, in the same order as the request items. */
export interface BulkContractResult {
  index: number;
  address: string | null;
  network: string | null;
  name: string | null;
  status: BulkContractStatus;
  id?: number;
  error?: string;
}

export interface BulkRegisterContractsResponse {
  results: BulkContractResult[];
}

export interface DecodedEventData {
  id: string;
  type: string;
  ledgerClosedAt: string;
  inSuccessfulContractCall: boolean;
  raw: {
    topic: string[];
    value: string;
  };
  decoded: {
    topic: unknown[];
    value: unknown;
  };
}

export interface EventRecord {
  id: number;
  contractId: number;
  ledger: number;
  txHash: string;
  topic: string;
  decodedData: DecodedEventData | null;
  createdAt: string;
}

export interface ListEventsParams {
  cursor?: number;
  limit?: number;
  topic?: string;
  from?: string;
  to?: string;
  order?: 'asc' | 'desc';
}

export interface WatchEventsOptions {
  /** How long to wait between polls once caught up, in ms. Defaults to 5000. */
  intervalMs?: number;
  /** Stops the watch: the iterator finishes (without throwing) and any in-flight request is aborted. */
  signal?: AbortSignal;
  /**
   * Where to start. `"latest"` skips every existing event and yields only ones indexed after the watch starts; a
   * number yields events with an id greater than it (e.g. the last id you processed). Omit to replay from the
   * contract's first event.
   */
  startAt?: "latest" | number;
  /** Only watch events whose first topic matches. */
  topic?: string;
  /** Page size per request (1–100). Defaults to 100. */
  limit?: number;
  /** Upper bound for the error backoff, in ms. Defaults to 60000. */
  maxBackoffMs?: number;
  /**
   * Called when a poll fails, before backing off. The watch keeps going: the delay doubles from `intervalMs` on
   * each consecutive failure (capped at `maxBackoffMs`) and resets after the next success.
   */
  onError?: (error: unknown, info: { attempt: number; retryInMs: number }) => void;
}

export interface TransferRecord {
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

export interface ListTransfersParams {
  cursor?: number;
  limit?: number;
  order?: 'asc' | 'desc';
}

export interface GetStatsParams {
  from?: string;
  to?: string;
}

export interface ContractStats {
  transferCount: number;
  uniqueSenders: number;
  uniqueReceivers: number;
  volumeByAsset: { asset: string; volume: string }[];
}

export interface TransactionLookup {
  events: EventRecord[];
  transfers: TransferRecord[];
}

export interface Page<T> {
  data: T[];
  nextCursor: number | null;
}
