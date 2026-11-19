export interface VerifyWebhookSignatureParams {
  /**
   * The raw webhook request body as a string or Uint8Array.
   * Make sure to use the raw unparsed body to avoid JSON serialization discrepancies.
   */
  body: string | Uint8Array;
  /**
   * The signature header sent by the webhook dispatcher.
   * Supports:
   * - Legacy format: `sha256=<hex>` or raw `<hex>`
   * - Timestamped format: `t=<timestamp>,v1=<hex>` or `t=<timestamp>,sha256=<hex>`
   */
  signatureHeader: string;
  /**
   * The shared secret key configured for the webhook endpoint.
   */
  secret: string;
  /**
   * Optional separate timestamp header (e.g., from `X-Webhook-Timestamp`).
   * If not provided, timestamp will be extracted from `signatureHeader` if formatted like `t=<timestamp>`.
   */
  timestampHeader?: string | number;
  /**
   * Maximum allowed age difference in seconds between the timestamp and current server time.
   * Defaults to 300 seconds (5 minutes) when a timestamp is present.
   * Set to 0 or Infinity to disable tolerance checking.
   */
  toleranceSeconds?: number;
}

/**
 * Constant-time comparison between two Uint8Arrays to prevent timing attacks.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

/**
 * Converts a hex string into a Uint8Array.
 * Returns null if the hex string has an odd length or contains invalid characters.
 */
function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Parses a numeric timestamp from number, unix seconds string, milliseconds, or ISO date string.
 * Returns timestamp in integer epoch seconds, or null if unparseable.
 */
function parseTimestamp(ts: string | number): number | null {
  if (typeof ts === "number") {
    if (Number.isNaN(ts) || !Number.isFinite(ts)) return null;
    return ts > 1e11 ? Math.floor(ts / 1000) : Math.floor(ts);
  }
  const str = String(ts).trim();
  if (!str) return null;
  const num = Number(str);
  if (!Number.isNaN(num) && Number.isFinite(num)) {
    return num > 1e11 ? Math.floor(num / 1000) : Math.floor(num);
  }
  const dateMs = Date.parse(str);
  if (!Number.isNaN(dateMs)) {
    return Math.floor(dateMs / 1000);
  }
  return null;
}

/**
 * Uses WebCrypto API to verify HMAC-SHA256 signature in constant-time.
 * Works uniformly across Node.js 18+ and edge runtimes (Cloudflare Workers, Vercel Edge, etc.).
 */
async function verifyHmacSha256(
  secret: string,
  expectedSignatureBytes: Uint8Array,
  data: Uint8Array
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  return globalThis.crypto.subtle.verify("HMAC", key, expectedSignatureBytes, data);
}

/**
 * Verifies the authenticity and freshness of an incoming webhook delivery.
 *
 * Supports:
 * - Legacy format: `sha256=<hex>` (matching indexer deliveries) or raw `<hex>`
 * - Timestamped format: `t=<timestamp>,v1=<hex>` or separate `timestampHeader`
 * - Constant-time comparison to guard against timing attacks
 * - Node.js and edge runtimes using standard WebCrypto (`globalThis.crypto.subtle`)
 *
 * @param params Verification parameters
 * @returns Promise resolving to `true` if valid, `false` otherwise
 */
export async function verifyWebhookSignature({
  body,
  signatureHeader,
  secret,
  timestampHeader,
  toleranceSeconds
}: VerifyWebhookSignatureParams): Promise<boolean> {
  if (!secret || !signatureHeader || body === undefined || body === null) {
    return false;
  }

  let extractedTimestamp: number | null =
    timestampHeader !== undefined && timestampHeader !== null
      ? parseTimestamp(timestampHeader)
      : null;

  const candidateSignatures: string[] = [];
  const segments = signatureHeader.split(",").map((s) => s.trim()).filter(Boolean);

  for (const segment of segments) {
    if (segment.startsWith("t=")) {
      if (extractedTimestamp === null) {
        extractedTimestamp = parseTimestamp(segment.substring(2));
      }
    } else if (segment.startsWith("sha256=")) {
      candidateSignatures.push(segment.substring(7));
    } else if (segment.startsWith("v1=")) {
      candidateSignatures.push(segment.substring(3));
    } else if (segment.startsWith("v0=")) {
      candidateSignatures.push(segment.substring(3));
    } else if (segment.includes("=")) {
      candidateSignatures.push(segment.substring(segment.indexOf("=") + 1));
    } else {
      candidateSignatures.push(segment);
    }
  }

  if (candidateSignatures.length === 0) {
    return false;
  }

  // Tolerance check for timestamped deliveries
  if (extractedTimestamp !== null) {
    const tolerance = toleranceSeconds ?? 300;
    if (tolerance > 0) {
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - extractedTimestamp) > tolerance) {
        return false;
      }
    }
  }

  const encoder = new TextEncoder();
  const bodyString =
    typeof body === "string" ? body : new TextDecoder("utf-8").decode(body);
  const rawBodyBytes = encoder.encode(bodyString);

  const payloadsToCheck: Uint8Array[] = [];

  if (extractedTimestamp !== null) {
    payloadsToCheck.push(encoder.encode(`${extractedTimestamp}.${bodyString}`));
    payloadsToCheck.push(encoder.encode(`${extractedTimestamp}:${bodyString}`));
  }
  payloadsToCheck.push(rawBodyBytes);

  for (const signatureHex of candidateSignatures) {
    const signatureBytes = hexToBytes(signatureHex);
    if (!signatureBytes) {
      continue;
    }

    for (const payload of payloadsToCheck) {
      try {
        const isValid = await verifyHmacSha256(secret, signatureBytes, payload);
        if (isValid) {
          return true;
        }
      } catch {
        // Fall back to timingSafeEqual if subtle.verify throws
        try {
          const key = await globalThis.crypto.subtle.importKey(
            "raw",
            encoder.encode(secret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
          );
          const computedBuffer = await globalThis.crypto.subtle.sign("HMAC", key, payload);
          if (timingSafeEqual(new Uint8Array(computedBuffer), signatureBytes)) {
            return true;
          }
        } catch {
          // Ignore and continue checking
        }
      }
    }
  }

  return false;
}
