import { and, eq } from "drizzle-orm";
import {
  assertPublicWebhookUrl,
  NonPublicWebhookUrlError,
  webhookDeliveries as webhookDeliveriesTable,
  webhooks as webhooksTable,
  type Database
} from "@stellarlens/db";
import {
  WEBHOOK_CONCURRENCY,
  WEBHOOK_MAX_RETRIES,
  WEBHOOK_RETRY_BASE_DELAY_MS,
  WEBHOOK_RETRY_MAX_DELAY_MS,
  WEBHOOK_TIMEOUT_MS
} from "./config.js";
import { withRetry } from "./retry.js";
import { WEBHOOK_SIGNATURE_HEADER, signWebhookPayload } from "./webhook-signature.js";

export interface WebhookEventPayload {
  eventId: number;
  contractId: number;
  contractAddress: string;
  ledger: number;
  txHash: string;
  topic: unknown[];
  value: unknown;
}

export { assertPublicWebhookUrl, NonPublicWebhookUrlError };

async function postWebhook(url: string, body: string, signature: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [WEBHOOK_SIGNATURE_HEADER]: signature
      },
      body,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`webhook responded with status ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/** A webhook with no eventTypes fires on everything; otherwise the event's topic[0] must be in the list. */
function matchesEventTypes(
  webhook: { eventTypes: string[] | null },
  payload: WebhookEventPayload
): boolean {
  if (!webhook.eventTypes || webhook.eventTypes.length === 0) {
    return true;
  }
  const eventType = payload.topic[0];
  return typeof eventType === "string" && webhook.eventTypes.includes(eventType);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isDnsResolutionFailure(err: unknown): boolean {
  const dnsErrorCodes = new Set(["ENOTFOUND", "EAI_NONAME", "ENODATA", "EAI_FAIL"]);
  const seen = new Set<object>();
  let current = err;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && typeof current.code === "string" && dnsErrorCodes.has(current.code)) {
      return true;
    }
    current = "cause" in current ? current.cause : undefined;
  }

  return false;
}

/**
 * Persist a delivery outcome without letting an observability write break ingestion.
 * This is intentionally best-effort: persistence errors are logged and swallowed.
 */
async function recordDelivery(
  db: Database,
  outcome: {
    webhookId: number;
    eventId: number;
    status: "success" | "failed";
    attempts: number;
    lastError: string | null;
    deliveredAt: Date | null;
  }
): Promise<void> {
  try {
    await db.insert(webhookDeliveriesTable).values(outcome);
  } catch (err) {
    console.error(`webhook ${outcome.webhookId} delivery outcome could not be persisted:`, err);
  }
}

/** Best-effort delivery: failures are logged, never thrown, so one bad endpoint can't stall indexing. */
export async function deliverWebhooksForEvent(
  db: Database,
  payload: WebhookEventPayload
): Promise<void> {
  let recipients: Array<typeof webhooksTable.$inferSelect>;

  try {
    recipients = (
      await db
        .select()
        .from(webhooksTable)
        .where(
          and(eq(webhooksTable.contractId, payload.contractId), eq(webhooksTable.active, true))
        )
    ).filter((webhook) => matchesEventTypes(webhook, payload));
  } catch (err) {
    console.error(
      `webhook recipients could not be loaded for contract ${payload.contractId}:`,
      err
    );
    return;
  }

  if (recipients.length === 0) {
    return;
  }

  const { contractAddress, ...eventPayload } = payload;
  const body = JSON.stringify(eventPayload);

  let nextRecipientIndex = 0;
  const workerCount = Math.min(WEBHOOK_CONCURRENCY, recipients.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextRecipientIndex < recipients.length) {
        const webhook = recipients[nextRecipientIndex++];
        let attempts = 0;

        let secret: string;
        try {
          const signature = signWebhookPayload(webhook.secret, body);
          await withRetry(
            `webhook:${webhook.id}`,
            async () => {
              attempts += 1;
              await assertPublicWebhookUrl(webhook.url);
              return postWebhook(webhook.url, body, signature);
            },
            {
              maxRetries: WEBHOOK_MAX_RETRIES,
              baseDelayMs: WEBHOOK_RETRY_BASE_DELAY_MS,
              maxDelayMs: WEBHOOK_RETRY_MAX_DELAY_MS,
              shouldRetry: (err) => !(err instanceof NonPublicWebhookUrlError) && !isDnsResolutionFailure(err)
            }
          );

          await recordDelivery(db, {
            webhookId: webhook.id,
            eventId: payload.eventId,
            status: "success",
            attempts,
            lastError: null,
            deliveredAt: new Date()
          });
        } catch (err) {
          const dnsFailure = isDnsResolutionFailure(err);
          console.error(
            dnsFailure
              ? `webhook ${webhook.id} for contract ${contractAddress} endpoint ${webhook.url} is unreachable due to DNS resolution failure:`
              : `webhook ${webhook.id} for contract ${contractAddress} delivery failed after retries:`,
            err
          );

          await recordDelivery(db, {
            webhookId: webhook.id,
            eventId: payload.eventId,
            status: "failed",
            attempts,
            lastError: dnsFailure
              ? `DNS resolution failed for ${webhook.url}: ${errorMessage(err)}`
              : errorMessage(err),
            deliveredAt: null
          });
        }
      }
    })
  );
}
