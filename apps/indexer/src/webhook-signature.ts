import { createHmac } from "node:crypto";

/** Header carrying the HMAC signature, always formatted as `sha256=<lowercase hex>`. */
export const WEBHOOK_SIGNATURE_HEADER = "X-Webhook-Signature";
/** Header carrying the unix timestamp (seconds) bound into a timestamped signature. */
export const WEBHOOK_TIMESTAMP_HEADER = "X-Webhook-Timestamp";

/**
 * Signs a webhook body, returning the `X-Webhook-Signature` header value.
 *
 * - Legacy format (no timestamp): `sha256=HMAC_SHA256(secret, body)`.
 * - Timestamped format: `sha256=HMAC_SHA256(secret, "<timestamp>.<body>")`, with the same `<timestamp>`
 *   (unix seconds) sent in `X-Webhook-Timestamp` so receivers can reject replays.
 *
 * `@stellarlens/sdk`'s `verifyWebhookSignature` is the receiving side of this; the shared fixtures in
 * `test/fixtures/webhook-signatures.json` are produced by this function and checked by both packages.
 */
export function signWebhookPayload(secret: string, body: string, timestamp?: number): string {
  const signed = timestamp === undefined ? body : `${timestamp}.${body}`;
  return `sha256=${createHmac("sha256", secret).update(signed).digest("hex")}`;
}
