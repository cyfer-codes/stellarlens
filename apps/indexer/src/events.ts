import { eq } from "drizzle-orm";
import type { rpc } from "@stellar/stellar-sdk";
import { events as eventsTable, indexerCheckpoints, tokenTransfers, type Database } from "@stellarlens/db";
import { EVENTS_BATCH_LIMIT, STELLAR_NETWORK } from "./config.js";
import { decodeScVal } from "./decode.js";
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

export interface ProcessEventsBatchResult {
  indexedCount: number;
  cursor: string | null;
}

export async function processEventsBatch(db: Database, server: rpc.Server): Promise<ProcessEventsBatchResult> {
  const registeredContracts = await loadRegisteredContracts(db, STELLAR_NETWORK);
  if (registeredContracts.size === 0) {
    return { indexedCount: 0, cursor: null };
  }

  const cursor = await getStoredCursor(db);

  const request = cursor
    ? { filters: [{ type: "contract" as const }], cursor, limit: EVENTS_BATCH_LIMIT }
    : {
        filters: [{ type: "contract" as const }],
        startLedger: (await withRetry("getLatestLedger", () => server._getLatestLedger())).sequence,
        limit: EVENTS_BATCH_LIMIT
      };

  const response = await withRetry("getEvents", () => server._getEvents(request));

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
      const decodedTopic = rawTopic.map(decodeScVal);
      const decodedValue = decodeScVal(event.value);

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
            }
          }
        })
        .returning({ id: eventsTable.id });

      webhookPayloads.push({
        eventId: insertedEvent.id,
        contractId,
        ledger: event.ledger,
        txHash: event.txHash,
        topic: decodedTopic,
        value: decodedValue
      });

      const transfer = detectTransfer(decodedTopic, decodedValue);
      if (transfer) {
        await tx.insert(tokenTransfers).values({
          contractId,
          from: transfer.from,
          to: transfer.to,
          amount: transfer.amount,
          asset: event.contractId,
          txHash: event.txHash,
          ledger: event.ledger
        });
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
