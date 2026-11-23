import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { Agent } from "undici";
import { and, eq } from "drizzle-orm";
import {
  webhookDeliveries as webhookDeliveriesTable,
  webhooks as webhooksTable,
  type Database,
  type WebhookFilter
} from "@stellarlens/db";
import {
  WEBHOOK_CONCURRENCY,
  WEBHOOK_MAX_RETRIES,
  WEBHOOK_RETRY_BASE_DELAY_MS,
  WEBHOOK_RETRY_MAX_DELAY_MS,
  WEBHOOK_TIMEOUT_MS
} from "./config.js";
import { logger } from "./logger.js";
import { withRetry } from "./retry.js";
import { webhookDeliveriesTotal } from "./metrics.js";
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

const defaultResolve: DnsResolver = (hostname) => lookup(hostname, { all: true, verbatim: true });

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

/**
 * True only for globally routable unicast addresses. Anything outside 2000::/3 (loopback,
 * IPv4-compatible, NAT64 64:ff9b::/96 and 64:ff9b:1::/48, discard-only 100::/64, ULA,
 * link-local, multicast) is rejected, as is the whole IETF protocol assignment block
 * 2001::/23 (Teredo, benchmarking, ORCHIDv2, ...). Malformed input returns false.
 */
export function ipIsPublic(address: string): boolean {
  try {
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
    const documentation = value >> 96n === 0x20010db8n || value >> 108n === 0x3fff0n;
    const specialUse = value >> 105n === 0x100080n || value >> 112n === 0x2002n;
    return globalUnicast && !documentation && !specialUse;
  } catch {
    return false;
  }
}

export class NonPublicWebhookUrlError extends Error {
  constructor() {
    super("webhook URL resolves to a non-public IP address");
    this.name = "NonPublicWebhookUrlError";
  }
}

export async function assertPublicWebhookUrl(
  url: string,
  resolve: DnsResolver = defaultResolve
): Promise<void> {
  const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname }] : await resolve(hostname);

  if (addresses.length === 0 || addresses.some(({ address }) => !ipIsPublic(address))) {
    throw new NonPublicWebhookUrlError();
  }
}

export class WebhookRedirectError extends Error {
  constructor(status: number, location: string | null) {
    super(
      `webhook responded with redirect status ${status}${location ? ` to ${location}` : ""}; redirects are not followed`
    );
    this.name = "WebhookRedirectError";
  }
}

/**
 * DNS lookup used for the delivery connection itself. It resolves the host again and only hands
 * back addresses that pass the public-IP check, so a rebinding DNS server can't swap in a private
 * address between `assertPublicWebhookUrl` and the request. Because only the lookup is replaced,
 * TLS SNI and the Host header still use the original hostname.
 */
export function createPublicOnlyLookup(resolve: DnsResolver = defaultResolve): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0 || addresses.some(({ address }) => !ipIsPublic(address))) {
          callback(new NonPublicWebhookUrlError(), "", 0);
          return;
        }
        const resolved = addresses.map(({ address }) => ({ address, family: isIP(address) }));
        if ((options as { all?: boolean }).all) {
          (callback as unknown as (err: null, addresses: typeof resolved) => void)(null, resolved);
          return;
        }
        callback(null, resolved[0].address, resolved[0].family);
      },
      (err: NodeJS.ErrnoException) => callback(err, "", 0)
    );
  };
}

/** Dispatcher whose connections are pinned to addresses validated by `createPublicOnlyLookup`. */
export function createWebhookAgent(resolve: DnsResolver = defaultResolve): Agent {
  return new Agent({ connect: { lookup: createPublicOnlyLookup(resolve) } });
}

const webhookAgent = createWebhookAgent();

/** Stable across every retry of the same webhook/event pair so receivers can deduplicate. */
export function webhookDeliveryId(webhookId: number, eventId: number): string {
  return `wh_${webhookId}_evt_${eventId}`;
}

function webhookEventType(payload: WebhookEventPayload): string {
  const eventType = payload.topic[0];
  return typeof eventType === "string" ? eventType : "unknown";
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
  deliveryHeaders: Record<string, string>,
  timeoutMs: number = WEBHOOK_TIMEOUT_MS
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...deliveryHeaders,
        [WEBHOOK_SIGNATURE_HEADER]: signature
      },
      body,
      // Never follow redirects: the private-address check only covers the configured URL.
      redirect: "manual",
      signal: controller.signal,
      dispatcher: webhookAgent
    } as RequestInit);

    if (response.status >= 300 && response.status < 400) {
      throw new WebhookRedirectError(response.status, response.headers.get("location"));
    }

    if (!response.ok) {
      throw new WebhookResponseError(
        response.status,
        parseRetryAfterMs(response.headers.get("retry-after"))
      );
    }
  } catch (err) {
    // A rebinding answer rejected by the pinned lookup surfaces as fetch's `cause`.
    if (err instanceof Error && err.cause instanceof NonPublicWebhookUrlError) {
      throw err.cause;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export interface WebhookFilterMatchTarget {
  eventTypes?: string[] | null;
  filter?: WebhookFilter | null;
}

/**
 * Evaluates whether an event payload matches the webhook subscription's criteria.
 *
 * 1. If `eventTypes` is configured, `payload.topic[0]` must match one of the allowed types.
 * 2. If `filter.topics` is configured, positional topic matching is enforced:
 *    - Each element must equal the corresponding event topic at the same index,
 *      or be `null` to act as a wildcard matching any value.
 *    - The event must have at least as many topics as the filter specifies.
 * 3. If neither filter is configured, the webhook matches all events for its contract.
 */
export function matchesFilter(
  webhook: WebhookFilterMatchTarget,
  payload: WebhookEventPayload
): boolean {
  if (webhook.eventTypes && webhook.eventTypes.length > 0) {
    const eventType = payload.topic[0];
    if (typeof eventType !== "string" || !webhook.eventTypes.includes(eventType)) {
      return false;
    }
  }

  if (webhook.filter?.topics && webhook.filter.topics.length > 0) {
    const { topics } = webhook.filter;
    if (!Array.isArray(payload.topic) || payload.topic.length < topics.length) {
      return false;
    }
    for (let i = 0; i < topics.length; i++) {
      const expected = topics[i];
      if (expected === null) {
        continue;
      }
      const actual = payload.topic[i];
      if (actual !== expected && String(actual) !== expected) {
        return false;
      }
    }
  }

  return true;
}

/** Backwards-compatible alias for matchesFilter. */
export function matchesEventTypes(
  webhook: WebhookFilterMatchTarget,
  payload: WebhookEventPayload
): boolean {
  return matchesFilter(webhook, payload);
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
    logger.warn("webhook paused after 410 Gone response", {
      webhookId: webhook.id,
      url: webhook.url,
      active: false
    });
  } catch (err) {
    logger.error("webhook could not be paused after 410 Gone response", {
      webhookId: webhook.id,
      url: webhook.url,
      error: errorMessage(err)
    });
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
    idempotencyKey: string;
    status: "success" | "failed";
    attempts: number;
    lastError: string | null;
    deliveredAt: Date | null;
  }
): Promise<void> {
  try {
    await db.insert(webhookDeliveriesTable).values(outcome);
  } catch (err) {
    logger.error("webhook delivery outcome could not be persisted", {
      webhookId: outcome.webhookId,
      eventId: outcome.eventId,
      idempotencyKey: outcome.idempotencyKey,
      status: outcome.status,
      attempts: outcome.attempts,
      error: errorMessage(err)
    });
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
    logger.error("webhook recipients could not be loaded", {
      contractId: payload.contractId,
      contractAddress: payload.contractAddress,
      eventId: payload.eventId,
      ledger: payload.ledger,
      error: errorMessage(err)
    });
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
        const deliveryId = webhookDeliveryId(webhook.id, payload.eventId);
        let attempts = 0;

        try {
          const signature = signWebhookPayload(webhook.secret, body);
          await withRetry(
            `webhook:${webhook.id}`,
            async () => {
              attempts += 1;
              await assertPublicWebhookUrl(webhook.url);
              return postWebhook(webhook.url, body, signature, {
                "X-Webhook-Id": deliveryId,
                "X-Webhook-Event": webhookEventType(payload),
                "X-Webhook-Attempt": String(attempts)
              });
            },
            {
              maxRetries: WEBHOOK_MAX_RETRIES,
              baseDelayMs: WEBHOOK_RETRY_BASE_DELAY_MS,
              maxDelayMs: WEBHOOK_RETRY_MAX_DELAY_MS,
              shouldRetry: shouldRetryWebhookDelivery,
              retryDelayMs: webhookRetryDelayMs
            }
          );

          webhookDeliveriesTotal.inc({ outcome: "success" });

          await recordDelivery(db, {
            webhookId: webhook.id,
            eventId: payload.eventId,
            idempotencyKey: deliveryId,
            status: "success",
            attempts,
            lastError: null,
            deliveredAt: new Date()
          });
        } catch (err) {
          webhookDeliveriesTotal.inc({ outcome: "failed" });

          const dnsFailure = isDnsResolutionFailure(err);
          const gone = err instanceof WebhookResponseError && err.status === 410;

          logger.error(
            dnsFailure
              ? "webhook endpoint is unreachable due to DNS resolution failure"
              : gone
                ? "webhook endpoint is permanently gone (410 Gone)"
                : "webhook delivery failed after retries",
            {
              webhookId: webhook.id,
              contractId: payload.contractId,
              contractAddress,
              eventId: payload.eventId,
              ledger: payload.ledger,
              txHash: payload.txHash,
              url: webhook.url,
              deliveryId,
              attempts,
              error: errorMessage(err)
            }
          );

          if (gone) {
            await pauseWebhook(db, webhook);
          }

          await recordDelivery(db, {
            webhookId: webhook.id,
            eventId: payload.eventId,
            idempotencyKey: deliveryId,
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