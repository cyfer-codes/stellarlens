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
