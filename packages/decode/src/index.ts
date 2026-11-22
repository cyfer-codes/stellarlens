import { scValToNative, xdr } from "@stellar/stellar-sdk";

function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Uint8Array || (typeof Buffer !== "undefined" && Buffer.isBuffer(value))) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("hex");
  }
  if (Array.isArray(value)) {
    return value.map(toJsonSafe);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [key, toJsonSafe(val)])
    );
  }
  return value;
}

/**
 * Decodes a base64 `ScVal` into plain JSON: the indexer stores event topics/values this way, and
 * `stellarlens decode` uses the same function so both always agree. Throws on invalid XDR.
 */
export function decodeScVal(base64Xdr: string): unknown {
  const scVal = xdr.ScVal.fromXdr(base64Xdr, "base64");
  return toJsonSafe(scValToNative(scVal));
}

export type DecodeResult = { ok: true; value: unknown } | { ok: false; error: string };

export function tryDecodeScVal(base64Xdr: string): DecodeResult {
  try {
    return { ok: true, value: decodeScVal(base64Xdr) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
