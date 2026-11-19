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
/** Header the stellarlens indexer puts the signature in (lower-cased, as most frameworks expose it). */
export const WEBHOOK_SIGNATURE_HEADER = "x-webhook-signature";
/** Header carrying the unix timestamp (seconds) for the timestamped signature format. */
export const WEBHOOK_TIMESTAMP_HEADER = "x-webhook-timestamp";

/** Default allowed clock skew / replay window for timestamped signatures. */
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

export interface VerifyWebhookSignatureOptions {
  /**
   * The raw request body exactly as received — not re-serialized JSON. Re-stringifying a parsed body can change
   * key order or whitespace and break the signature.
   */
  body: string | Uint8Array | ArrayBuffer;
  /** Value of the `X-Webhook-Signature` header, e.g. `sha256=9f86d0…`. */
  signatureHeader: string | null | undefined;
  /** The webhook's secret, as returned once when the webhook was registered. */
  secret: string;
  /**
   * Value of the `X-Webhook-Timestamp` header (unix seconds). When given, the signature is checked against
   * `"<timestamp>.<body>"` and the timestamp must be within `toleranceSeconds` of now. When omitted, the legacy
   * format (signature over the body alone) is used.
   */
  timestampHeader?: string | null;
  /** Max allowed age/skew of `timestampHeader`, in seconds. Defaults to 300. */
  toleranceSeconds?: number;
}

const SIGNATURE_PREFIX = "sha256=";
const encoder = new TextEncoder();

function toBytes(body: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof body === "string") {
    return encoder.encode(body);
  }
  return body instanceof Uint8Array ? body : new Uint8Array(body);
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Parses `sha256=<64 hex chars>` into 32 bytes, or null if malformed. */
function parseSignature(header: string): Uint8Array | null {
  const value = header.trim();
  if (!value.toLowerCase().startsWith(SIGNATURE_PREFIX)) {
    return null;
  }
  const hex = value.slice(SIGNATURE_PREFIX.length);
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Compares two byte arrays in time that depends only on their length, never on where they differ. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

function getSubtle(): typeof globalThis.crypto.subtle {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "verifyWebhookSignature requires the WebCrypto API (globalThis.crypto.subtle) — use Node.js 20+ or an edge runtime"
    );
  }
  return subtle;
}

/**
 * Verifies a stellarlens webhook delivery. Resolves `true` only if the signature matches; any missing, malformed
 * or stale input resolves `false` rather than throwing, so it is safe to call on untrusted requests.
 *
 * Uses WebCrypto, so it runs unchanged in Node.js 20+, Deno, Bun, Cloudflare Workers and Vercel/Next.js edge
 * routes. The final comparison is constant-time.
 */
export async function verifyWebhookSignature(options: VerifyWebhookSignatureOptions): Promise<boolean> {
  const { signatureHeader, secret, timestampHeader } = options;
  if (!signatureHeader || !secret) {
    return false;
  }

  const expected = parseSignature(signatureHeader);
  if (!expected) {
    return false;
  }

  let signed = toBytes(options.body);

  if (timestampHeader !== undefined && timestampHeader !== null) {
    const raw = timestampHeader.trim();
    if (!/^\d{1,15}$/.test(raw)) {
      return false;
    }
    const tolerance = options.toleranceSeconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - Number(raw)) > tolerance) {
      return false;
    }
    signed = concatBytes(encoder.encode(`${raw}.`), signed);
  }

  const subtle = getSubtle();
  const key = await subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign"
  ]);
  const actual = new Uint8Array(await subtle.sign("HMAC", key, signed));

  return timingSafeEqual(actual, expected);
}
