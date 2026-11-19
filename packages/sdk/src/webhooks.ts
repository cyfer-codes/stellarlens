import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Header the indexer puts each webhook delivery's signature in. Node lower-cases incoming header names,
 * so this is the key to read from `req.headers`.
 */
export const WEBHOOK_SIGNATURE_HEADER = "x-webhook-signature";

const SIGNATURE_PREFIX = "sha256=";

/**
 * Signs a webhook body the same way the indexer does: an HMAC-SHA256 of the exact raw body bytes,
 * hex encoded and prefixed with `sha256=`.
 */
export function signWebhookPayload(body: string | Uint8Array, secret: string): string {
  return `${SIGNATURE_PREFIX}${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/**
 * Checks a delivery's `X-Webhook-Signature` header against its raw body. Always verify the raw bytes as
 * received: re-serializing parsed JSON can reorder keys or change whitespace and break the signature.
 * Uses a constant-time comparison and returns false (never throws) for missing or malformed headers.
 */
export function verifyWebhookSignature(
  body: string | Uint8Array,
  signatureHeader: string | string[] | null | undefined,
  secret: string
): boolean {
  if (typeof signatureHeader !== "string" || !signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const received = Buffer.from(signatureHeader.slice(SIGNATURE_PREFIX.length).trim(), "hex");
  const expected = createHmac("sha256", secret).update(body).digest();

  return received.length === expected.length && timingSafeEqual(received, expected);
}
