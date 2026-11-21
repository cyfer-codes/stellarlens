import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, eq } from "drizzle-orm";
import {
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

type DnsResolver = (hostname: string) => Promise<Array<{ address: string }>>;

function ipv4IsPublic(address: string): boolean {
  const octets = address.split(".").map(Number);
  const [first, second, third] = octets;

  return !(
    first === 0 ||
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function ipv6ToBigInt(address: string): bigint {
  let normalized = address.toLowerCase();
  const ipv4Suffix = normalized.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4Suffix) {
    const octets = ipv4Suffix[1].split(".").map(Number);
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    normalized = normalized.replace(ipv4Suffix[1], `${high}:${low}`);
  }

  const [left = "", right] = normalized.split("::");
  const leftGroups = left ? left.split(":") : [];
  const rightGroups = right ? right.split(":") : [];
  const zeroGroups = Array(8 - leftGroups.length - rightGroups.length).fill("0");
  const groups = [...leftGroups, ...zeroGroups, ...rightGroups];

  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group || "0"}`), 0n);
}

function ipIsPublic(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return ipv4IsPublic(address);
  }
  if (family !== 6) {
    return false;
  }

  const value = ipv6ToBigInt(address);
  if (value >> 32n === 0xffffn) {
    const ipv4Bytes = (value & 0xffffffffn).toString(16).padStart(8, "0").match(/.{2}/g)!;
    return ipv4IsPublic(ipv4Bytes.map((byte) => parseInt(byte, 16)).join("."));
  }

  const globalUnicast = value >> 125n === 0b001n;
  const documentation = value >> 96n === 0x20010db8n;
  const specialUse = value >> 105n === 0x100080n || value >> 112n === 0x2002n;
  return globalUnicast && !documentation && !specialUse;
}

export class NonPublicWebhookUrlError extends Error {
  constructor() {
    super("webhook URL resolves to a non-public IP address");
    this.name = "NonPublicWebhookUrlError";
  }
}

export async function assertPublicWebhookUrl(
  url: string,
  resolve: DnsResolver = (hostname) => lookup(hostname, { all: true, verbatim: true })
): Promise<void> {
  const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname }] : await resolve(hostname);

  if (addresses.length === 0 || addresses.some(({ address }) => !ipIsPublic(address))) {
    throw new NonPublicWebhookUrlError();
  }
}

/**
 * A non-2xx response from a webhook endpoint. Carries the status code and, when the receiver sent a
 * `Retry-After` header, the delay it asked us to wait before the next attempt.
 */
export class WebhookResponseError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | undefined;

  constructor(status: number, retryAfterMs?: number) {
    super(`webhook responded with status ${status}`);
    this.name = "WebhookResponseError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Parses a `Retry-After` header, which is either a delay in seconds or an HTTP date. Returns the
 * delay in milliseconds, or `undefined` when the header is absent or malformed.
 */
export function parseRetryAfterMs(header: string | null, now = Date.now()): number | undefined {
  if (header === null) {
    return undefined;
  }

  const value = header.trim();
  if (value === "") {
    return undefined;
  }

  if (/^\d+$/.test(value)) {
    return Number(value) * 1000;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }
  return Math.max(0, timestamp - now);
}

/** POSTs one signed delivery, aborting it after `timeoutMs` (`WEBHOOK_TIMEOUT_MS` by default). */
async function postWebhook(
  url: string,
  body: string,
  signature: string,
  timeoutMs: number = WEBHOOK_TIMEOUT_MS
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
      throw new WebhookResponseError(
        response.status,
        parseRetryAfterMs(response.headers.get("retry-after"))
      );
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
 * HTTP-aware retry policy for webhook deliveries:
 * - 4xx responses other than 408 (Request Timeout) and 429 (Too Many Requests) will never
 *   succeed, so retrying them only wastes time and delays the next event.
 * - 410 Gone means the receiver is permanently gone, so there is nothing left to retry.
 * Blocked destinations and DNS failures were already non-retryable.
 */
function shouldRetryWebhookDelivery(err: unknown): boolean {
  if (err instanceof NonPublicWebhookUrlError || isDnsResolutionFailure(err)) {
    return false;
  }

  if (err instanceof WebhookResponseError) {
    const { status } = err;
    if (status === 410) {
      return false;
    }
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
      return false;
    }
  }

  return true;
}

/** Honour a receiver's `Retry-After` delay when it sent one; `withRetry` caps it at `maxDelayMs`. */
function webhookRetryDelayMs(err: unknown): number | undefined {
  return err instanceof WebhookResponseError ? err.retryAfterMs : undefined;
}

/** A 410 Gone means the endpoint is permanently gone, so pause the webhook until an operator resumes it. */
async function pauseWebhook(db: Database, webhook: { id: number; url: string }): Promise<void> {
  try {
    await db.update(webhooksTable).set({ active: false }).where(eq(webhooksTable.id, webhook.id));
    console.warn(
      `webhook ${webhook.id} for ${webhook.url} paused (active = false) after a 410 Gone response`
    );
  } catch (err) {
    console.error(`webhook ${webhook.id} could not be paused after a 410 Gone response:`, err);
  }
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
              shouldRetry: shouldRetryWebhookDelivery,
              retryDelayMs: webhookRetryDelayMs
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
          const gone = err instanceof WebhookResponseError && err.status === 410;

          console.error(
            dnsFailure
              ? `webhook ${webhook.id} for contract ${contractAddress} endpoint ${webhook.url} is unreachable due to DNS resolution failure:`
              : gone
                ? `webhook ${webhook.id} for contract ${contractAddress} endpoint ${webhook.url} is permanently gone (410 Gone):`
                : `webhook ${webhook.id} for contract ${contractAddress} delivery failed after retries:`,
            err
          );

          if (gone) {
            await pauseWebhook(db, webhook);
          }

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
