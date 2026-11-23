import { eq } from "drizzle-orm";
import type { rpc } from "@stellar/stellar-sdk";
import {
  events as eventsTable,
  indexerCheckpoints,
  tokenTransfers,
  type Database
} from "@stellarlens/db";
import { EVENTS_BATCH_LIMIT, STELLAR_NETWORK } from "./config.js";
import { tryDecodeScVal } from "@stellarlens/decode";
import { loadRegisteredContracts } from "./registry.js";
import { detectTokenMovement } from "./transfers.js";
import { withRetry } from "./retry.js";
import { deliverWebhooksForEvent, type WebhookEventPayload } from "./webhooks.js";
import {
  eventsIndexedTotal,
  indexerLagLedgers,
  pollDurationSeconds,
  rpcRetriesTotal
} from "./metrics.js";
import { logger } from "./logger.js";

async function getStoredCursor(db: Database): Promise<string | undefined> {
  const [row] = await db
    .select({ cursor: indexerCheckpoints.cursor })
    .from(indexerCheckpoints)
    .where(eq(indexerCheckpoints.network, STELLAR_NETWORK));
  return row?.cursor;
}

// Soroban RPC limits for getEvents filters. We chunk the registered contract
// ids so a single request never exceeds these bounds.
export const MAX_FILTERS_PER_REQUEST = 5;
export const MAX_CONTRACT_IDS_PER_FILTER = 100;

export interface ContractFilterChunk {
  filters: { type: "contract"; contractIds: string[] }[];
}

/**
 * Split the registered contract addresses into getEvents request chunks.
 *
 * Each request carries up to MAX_FILTERS_PER_REQUEST filters, and each filter
 * carries up to MAX_CONTRACT_IDS_PER_FILTER contract ids.
 */
export function chunkContractIds(contractAddresses: string[]): ContractFilterChunk[] {
  const chunks: ContractFilterChunk[] = [];
  const idsPerRequest = MAX_FILTERS_PER_REQUEST * MAX_CONTRACT_IDS_PER_FILTER;

  for (let i = 0; i < contractAddresses.length; i += idsPerRequest) {
    const requestIds = contractAddresses.slice(i, i + idsPerRequest);
    const filters: ContractFilterChunk["filters"] = [];
    for (let j = 0; j < requestIds.length; j += MAX_CONTRACT_IDS_PER_FILTER) {
      filters.push({
        type: "contract",
        contractIds: requestIds.slice(j, j + MAX_CONTRACT_IDS_PER_FILTER)
      });
    }
    chunks.push({ filters });
  }

  return chunks;
}

async function recordHeartbeat(
  db: Database,
  values: {
    lastPolledAt: Date;
    lastLedger: number;
    latestNetworkLedger: number;
    lastError: string | null;
  }
): Promise<void> {
  await db
    .insert(indexerCheckpoints)
    .values({
      network: STELLAR_NETWORK,
      lastPolledAt: values.lastPolledAt,
      lastLedger: values.lastLedger,
      latestNetworkLedger: values.latestNetworkLedger,
      lastError: values.lastError
    })
    .onConflictDoUpdate({
      target: indexerCheckpoints.network,
      set: {
        lastPolledAt: values.lastPolledAt,
        lastLedger: values.lastLedger,
        latestNetworkLedger: values.latestNetworkLedger,
        lastError: values.lastError,
        updatedAt: new Date()
      }
    });
}

type RawEvent = Awaited<ReturnType<rpc.Server["_getEvents"]>>["events"][number];

export interface DecodeError {
  field: string;
  error: string;
}

export interface DecodedEventPayload {
  decodedTopic: unknown[];
  decodedValue: unknown;
  decodeErrors: DecodeError[];
}

/**
 * Minimal shape needed to (re-)decode an event payload. Both live RPC events
 * and rows read back from the database (raw XDR) satisfy this.
 */
export interface DecodableEvent {
  id: string;
  contractId: string;
  ledger: number;
  txHash: string;
  topic: string[];
  value: string;
}

export function decodeEventPayload(event: DecodableEvent): DecodedEventPayload {
  const decodeErrors: DecodeError[] = [];

  const decodeField = (field: string, base64Xdr: string): unknown => {
    const result = tryDecodeScVal(base64Xdr);
    if (result.ok) {
      return result.value;
    }
    decodeErrors.push({ field, error: result.error });
    return null;
  };

  const decodedTopic = (event.topic ?? []).map((topic, index) => decodeField(`topic[${index}]`, topic));
  const decodedValue = decodeField("value", event.value);

  if (decodeErrors.length > 0) {
    logger.warn("failed to decode event", {
      eventId: event.id,
      contractAddress: event.contractId,
      ledger: event.ledger,
      txHash: event.txHash,
      decodeErrors
    });
  }

  return { decodedTopic, decodedValue, decodeErrors };
}

/**
 * Re-detect a transfer from already-decoded topic/value and upsert it
 * idempotently. Shared by the live indexer and the `redecode` job so both
 * paths store the same `asset` value (SAC `topic[3]` string when present,
 * otherwise the emitting contract address).
 */
export async function upsertDetectedTransfer(
  tx: Pick<Database, "insert">,
  params: {
    contractId: string;
    contractAddress: string;
    decodedTopic: unknown[];
    decodedValue: unknown;
    txHash: string;
    ledger: number;
    rpcEventId: string;
  }
): Promise<boolean> {
  const transfer = detectTransfer(params.decodedTopic, params.decodedValue);
  if (!transfer) {
    return false;
  }

  await tx
    .insert(tokenTransfers)
    .values({
      contractId: params.contractId,
      from: transfer.from,
      to: transfer.to,
      amount: transfer.amount,
      asset: transfer.asset ?? params.contractAddress,
      txHash: params.txHash,
      ledger: params.ledger,
      rpcEventId: params.rpcEventId
    })
    .onConflictDoNothing();

  return true;
}

export interface ProcessEventsBatchResult {
  indexedCount: number;
  cursor: string | null;
}

export async function processEventsBatch(
  db: Database,
  server: rpc.Server
): Promise<ProcessEventsBatchResult> {
  const cycleStart = process.hrtime.bigint();
  const endCycle = () => {
    const elapsedSeconds = Number(process.hrtime.bigint() - cycleStart) / 1e9;
    pollDurationSeconds.observe(elapsedSeconds);
  };

  const registeredContracts = await loadRegisteredContracts(db, STELLAR_NETWORK);
  if (registeredContracts.size === 0) {
    endCycle();
    return { indexedCount: 0, cursor: null };
  }

  const cursor = await getStoredCursor(db);

  // Cursor strategy: we keep a single stored cursor per network and only
  // advance it after every chunk for this cycle succeeds. When the registered
  // contract set changes, the next cycle re-requests from the stored cursor
  // with the new contractIds, so no events are lost (at worst some events are
  // re-fetched and deduped by the existing unique constraints).
  const contractAddresses = [...registeredContracts.keys()];
  const chunks = chunkContractIds(contractAddresses);

  const startLedger = cursor
    ? undefined
    : (await withRetry("getLatestLedger", () => server._getLatestLedger())).sequence;

  const responses: Awaited<ReturnType<rpc.Server["_getEvents"]>>[] = [];
  try {
    for (const chunk of chunks) {
      const request = cursor
        ? { filters: chunk.filters, cursor, limit: EVENTS_BATCH_LIMIT }
        : { filters: chunk.filters, startLedger: startLedger!, limit: EVENTS_BATCH_LIMIT };
      responses.push(await withRetry("getEvents", () => server._getEvents(request)));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordHeartbeat(db, {
      lastPolledAt: new Date(),
      lastLedger: 0,
      latestNetworkLedger: 0,
      lastError: message
    });
    throw error;
  }

  const response = {
    events: responses.flatMap((r) => r.events),
    cursor: responses.length > 0 ? responses[responses.length - 1].cursor : cursor ?? "",
    latestLedger: responses.reduce((max, r) => Math.max(max, r.latestLedger), 0)
  };

  const highestEventLedger = response.events.reduce((max, e) => Math.max(max, e.ledger), 0);

  await recordHeartbeat(db, {
    lastPolledAt: new Date(),
    lastLedger: highestEventLedger > 0 ? highestEventLedger : response.latestLedger,
    latestNetworkLedger: response.latestLedger,
    lastError: null
  const request = cursor
    ? { filters: [{ type: "contract" as const }], cursor, limit: EVENTS_BATCH_LIMIT }
    : {
      filters: [{ type: "contract" as const }],
      startLedger: (await withRetry("getLatestLedger", () => server._getLatestLedger(), {
        onRetry: () => rpcRetriesTotal.inc({ method: "getLatestLedger" })
      })).sequence,
      limit: EVENTS_BATCH_LIMIT
    };

  const response = await withRetry("getEvents", () => server._getEvents(request), {
    onRetry: () => rpcRetriesTotal.inc({ method: "getEvents" })
  });

  let indexedCount = 0;
  const webhookPayloads: WebhookEventPayload[] = [];

  await db.transaction(async (tx) => {
    for (const event of response.events) {
      const contractId = registeredContracts.get(event.contractId);
      if (contractId === undefined) {
        continue;
      }
      indexedCount += 1;

      const rawTopic = event.topic ?? [];
      const { decodedTopic, decodedValue, decodeErrors } = decodeEventPayload(event);

      const [insertedEvent] = await tx
        .insert(eventsTable)
        .values({
          contractId,
          ledger: event.ledger,
          txHash: event.txHash,
          topic: JSON.stringify(rawTopic),
          decodedData: {
            id: event.id,
            type: event.type,
            ledgerClosedAt: event.ledgerClosedAt,
            inSuccessfulContractCall: event.inSuccessfulContractCall,
            raw: {
              topic: rawTopic,
              value: event.value
            },
            decoded: {
              topic: decodedTopic,
              value: decodedValue
            },
            ...(decodeErrors.length > 0 && { decodeErrors })
          }
        })
        .returning({ id: eventsTable.id });

      webhookPayloads.push({
        version: 1,
        eventId: insertedEvent.id,
        contractId,
        contractAddress: event.contractId,
        ledger: event.ledger,
        txHash: event.txHash,
        rpcEventId: event.id,
        ledgerClosedAt: event.ledgerClosedAt,
        inSuccessfulContractCall: event.inSuccessfulContractCall,
        topic: decodedTopic,
        value: decodedValue
      });

      const movement = detectTokenMovement(decodedTopic, decodedValue);
      if (movement) {
        await tx
          .insert(tokenTransfers)
          .values({
            contractId,
            kind: movement.kind,
            from: movement.from,
            to: movement.to,
            amount: movement.amount,
            asset: event.contractId,
            txHash: event.txHash,
            ledger: event.ledger,
            rpcEventId: event.id
          })
          .onConflictDoNothing();
      }
      await upsertDetectedTransfer(tx, {
        contractId,
        contractAddress: event.contractId,
        decodedTopic,
        decodedValue,
        txHash: event.txHash,
        ledger: event.ledger,
        rpcEventId: event.id
      });
    }

    await tx
      .insert(indexerCheckpoints)
      .values({ network: STELLAR_NETWORK, cursor: response.cursor, latestLedger: response.latestLedger })
      .onConflictDoUpdate({
        target: indexerCheckpoints.network,
        set: { cursor: response.cursor, latestLedger: response.latestLedger, updatedAt: new Date() }
      });
  });

  for (const payload of webhookPayloads) {
    await deliverWebhooksForEvent(db, payload);
  }

  eventsIndexedTotal.inc(indexedCount);
  indexerLagLedgers.set(Math.max(0, response.latestLedger - response.events.at(-1)!.ledger));
  endCycle();

  return { indexedCount, cursor: response.cursor };
}
