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
