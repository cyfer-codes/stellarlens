import { eq } from "drizzle-orm";
import type { rpc } from "@stellar/stellar-sdk";
import {
  events as eventsTable,
  indexerCheckpoints,
  tokenTransfers,
  type Database
} from "@stellarlens/db";
import { EVENTS_BATCH_LIMIT, STELLAR_NETWORK } from "./config.js";
import { tryDecodeScVal } from "./decode.js";
import { loadRegisteredContracts } from "./registry.js";
import { detectTransfer } from "./transfers.js";
import { withRetry } from "./retry.js";
import { deliverWebhooksForEvent, type WebhookEventPayload } from "./webhooks.js";

async function getStoredCursor(db: Database): Promise<string | undefined> {
  const [row] = await db
    .select({ cursor: indexerCheckpoints.cursor })
    .from(indexerCheckpoints)
    .where(eq(indexerCheckpoints.network, STELLAR_NETWORK));
  return row?.cursor;
}

type RawEvent = Awaited<ReturnType<rpc.Server["_getEvents"]>>["events"][number];

interface DecodeError {
  field: string;
  error: string;
}

interface DecodedEventPayload {
  decodedTopic: unknown[];
  decodedValue: unknown;
  decodeErrors: DecodeError[];
}

function decodeEventPayload(event: RawEvent): DecodedEventPayload {
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
    const details = decodeErrors.map(({ field, error }) => `${field}: ${error}`).join("; ");
    console.error(
      `failed to decode event ${event.id} (contract=${event.contractId}, ledger=${event.ledger}, tx=${event.txHash}): ${details}`
    );
  }

  return { decodedTopic, decodedValue, decodeErrors };
}

export interface ProcessEventsBatchResult {
  indexedCount: number;
  cursor: string | null;
}

export function isExpiredCursorError(error: unknown): boolean {
  if (!error) return false;

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error);

  const lower = message.toLowerCase();
  return (
    lower.includes("start is before oldest ledger") ||
    lower.includes("before oldest ledger") ||
    lower.includes("cursor is expired") ||
    lower.includes("expired cursor") ||
    lower.includes("cursor expired") ||
    lower.includes("cursor is invalid") ||
    (lower.includes("cursor") &&
      (lower.includes("expired") || lower.includes("oldest") || lower.includes("not found") || lower.includes("invalid")))
  );
}

export async function processEventsBatch(
  db: Database,
  server: rpc.Server
): Promise<ProcessEventsBatchResult> {
  const registeredContracts = await loadRegisteredContracts(db, STELLAR_NETWORK);
  if (registeredContracts.size === 0) {
    return { indexedCount: 0, cursor: null };
  }

  const cursor = await getStoredCursor(db);

  let response: Awaited<ReturnType<rpc.Server["_getEvents"]>>;

  if (cursor) {
    try {
      response = await withRetry(
        "getEvents",
        () =>
          server._getEvents({
            filters: [{ type: "contract" as const }],
            cursor,
            limit: EVENTS_BATCH_LIMIT
          }),
        {
          shouldRetry: (err) => !isExpiredCursorError(err)
        }
      );
    } catch (err) {
      if (isExpiredCursorError(err)) {
        console.warn(
          `stored cursor "${cursor}" has expired on RPC node; re-seeding indexer from latest ledger`
        );
        const latestLedger = (await withRetry("getLatestLedger", () => server._getLatestLedger())).sequence;
        response = await withRetry("getEvents", () =>
          server._getEvents({
            filters: [{ type: "contract" as const }],
            startLedger: latestLedger,
            limit: EVENTS_BATCH_LIMIT
          })
        );
      } else {
        throw err;
      }
    }
  } else {
    const latestLedger = (await withRetry("getLatestLedger", () => server._getLatestLedger())).sequence;
    response = await withRetry("getEvents", () =>
      server._getEvents({
        filters: [{ type: "contract" as const }],
        startLedger: latestLedger,
        limit: EVENTS_BATCH_LIMIT
      })
    );
  }

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
        eventId: insertedEvent.id,
        contractId,
        contractAddress: event.contractId,
        ledger: event.ledger,
        txHash: event.txHash,
        topic: decodedTopic,
        value: decodedValue
      });

      const transfer = detectTransfer(decodedTopic, decodedValue);
      if (transfer) {
        await tx
          .insert(tokenTransfers)
          .values({
            contractId,
            from: transfer.from,
            to: transfer.to,
            amount: transfer.amount,
            asset: event.contractId,
            txHash: event.txHash,
            ledger: event.ledger
          })
          .onConflictDoNothing();
      }
    }

    await tx
      .insert(indexerCheckpoints)
      .values({ network: STELLAR_NETWORK, cursor: response.cursor })
      .onConflictDoUpdate({
        target: indexerCheckpoints.network,
        set: { cursor: response.cursor }
      });
  });

  for (const payload of webhookPayloads) {
    await deliverWebhooksForEvent(db, payload);
  }

  return { indexedCount, cursor: response.cursor };
}
