import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { webhooks as webhooksTable, type Database } from "@stellarlens/db";
import { WEBHOOK_MAX_RETRIES, WEBHOOK_RETRY_BASE_DELAY_MS, WEBHOOK_RETRY_MAX_DELAY_MS, WEBHOOK_TIMEOUT_MS } from "./config.js";
import { withRetry } from "./retry.js";

export interface WebhookEventPayload {
  eventId: number;
  contractId: number;
  ledger: number;
  txHash: string;
  topic: unknown[];
  value: unknown;
}

async function postWebhook(url: string, body: string, signature: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": `sha256=${signature}`
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
function matchesEventTypes(webhook: { eventTypes: string[] | null }, payload: WebhookEventPayload): boolean {
  if (!webhook.eventTypes || webhook.eventTypes.length === 0) {
    return true;
  }
  const eventType = payload.topic[0];
  return typeof eventType === "string" && webhook.eventTypes.includes(eventType);
}

/** Best-effort delivery: failures are logged, never thrown, so one bad endpoint can't stall indexing. */
export async function deliverWebhooksForEvent(db: Database, payload: WebhookEventPayload): Promise<void> {
  const recipients = (
    await db.select().from(webhooksTable).where(eq(webhooksTable.contractId, payload.contractId))
  ).filter((webhook) => matchesEventTypes(webhook, payload));

  if (recipients.length === 0) {
    return;
  }

  const body = JSON.stringify(payload);

  await Promise.all(
    recipients.map(async (webhook) => {
      const signature = createHmac("sha256", webhook.secret).update(body).digest("hex");
      try {
        await withRetry(`webhook:${webhook.id}`, () => postWebhook(webhook.url, body, signature), {
          maxRetries: WEBHOOK_MAX_RETRIES,
          baseDelayMs: WEBHOOK_RETRY_BASE_DELAY_MS,
          maxDelayMs: WEBHOOK_RETRY_MAX_DELAY_MS
        });
      } catch (err) {
        console.error(`webhook ${webhook.id} delivery failed after retries:`, err);
      }
    })
  );
}
