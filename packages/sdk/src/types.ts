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

/** Per-call options accepted by every request-making `StellarLensClient` method. */
export interface RequestOptions {
  /**
   * Cancels the request. If it's already aborted, nothing is sent; if it aborts mid-flight, `fetch` is aborted.
   * Either way the call rejects with `signal.reason` (an `AbortError` `DOMException` unless you gave one).
   */
  signal?: AbortSignal;
  /**
   * Overrides the client's `timeoutMs` for this call. `0` disables the timeout. When it elapses the request is
   * aborted and the call rejects with a `StellarLensTimeoutError`.
   */
  timeoutMs?: number;
}

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

export interface TransactionLookup {
  events: EventRecord[];
  transfers: TransferRecord[];
}
