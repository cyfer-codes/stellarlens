import type { EventRecord } from "./types.js";

/** A SEP-41 `transfer` event, as detected by the stellarlens indexer. */
export interface ParsedTransfer {
  from: string;
  to: string;
  /** i128 amount as a decimal string (in the token's smallest unit). */
  amount: string;
  /** The recipient's muxed id for muxed transfers (`{ amount, to_muxed_id }` data), otherwise null. */
  toMuxedId: string | null;
}

export type TokenMovementKind = "transfer" | "mint" | "burn" | "clawback";

/** Any SEP-41 balance-changing event. `from` is null for mints; `to` is null for burns and clawbacks. */
export interface TokenMovement {
  kind: TokenMovementKind;
  from: string | null;
  to: string | null;
  amount: string;
  toMuxedId: string | null;
}

/** Anything carrying the indexer's decoded event data — an `EventRecord` from `listEvents`/`watchEvents`. */
export type DecodedEventLike = Pick<EventRecord, "decodedData">;

// G… account / C… contract (56 chars) or M… muxed account (69 chars).
const ADDRESS_PATTERN = /^(?:[GC][A-Z2-7]{55}|M[A-Z2-7]{68})$/;

function decodedParts(event: DecodedEventLike): { topic: unknown[]; value: unknown } | null {
  const decoded = event.decodedData?.decoded;
  if (!decoded || !Array.isArray(decoded.topic)) {
    return null;
  }
  return { topic: decoded.topic, value: decoded.value };
}

// Mirrors apps/indexer/src/transfers.ts: plain events carry the i128 amount as `value`; muxed events carry
// `{ amount, to_muxed_id }` instead.
function extractAmount(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "amount" in value) {
    const amount = (value as { amount: unknown }).amount;
    return typeof amount === "string" ? amount : undefined;
  }
  return undefined;
}

function extractMuxedId(value: unknown): string | null {
  if (value && typeof value === "object" && "to_muxed_id" in value) {
    const id = (value as { to_muxed_id: unknown }).to_muxed_id;
    if (typeof id === "string") return id;
    if (typeof id === "number" && Number.isFinite(id)) return String(id);
  }
  return null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Pre-CAP-67 tokens (and the old Stellar Asset Contract) put the admin first: `[mint, admin, to, …]` /
 * `[clawback, admin, from, …]`. Current SEP-41 drops the admin: `[mint, to, asset?]` / `[clawback, from, asset?]`,
 * where the optional trailing asset is a SEP-11 string ("native", "USDC:G…") rather than an address.
 */
function subjectAfterOptionalAdmin(topic: unknown[]): unknown {
  return isString(topic[2]) && ADDRESS_PATTERN.test(topic[2]) ? topic[2] : topic[1];
}

/**
 * Returns the transfer carried by a SEP-41 `transfer` event, or null for anything else. Uses exactly the same rules
 * as the indexer's transfer detection, so it agrees with what `listTransfers` returns.
 */
export function parseTransfer(event: DecodedEventLike): ParsedTransfer | null {
  const parts = decodedParts(event);
  if (!parts) {
    return null;
  }
  const { topic, value } = parts;
  if (topic.length < 3 || topic[0] !== "transfer" || !isString(topic[1]) || !isString(topic[2])) {
    return null;
  }
  const amount = extractAmount(value);
  if (amount === undefined) {
    return null;
  }
  return { from: topic[1], to: topic[2], amount, toMuxedId: extractMuxedId(value) };
}

/**
 * Returns any SEP-41 balance movement — `transfer`, `mint`, `burn` or `clawback` — or null. Transfers are
 * recognised exactly as `parseTransfer` (and the indexer) recognise them.
 */
export function parseTokenMovement(event: DecodedEventLike): TokenMovement | null {
  const transfer = parseTransfer(event);
  if (transfer) {
    return { kind: "transfer", ...transfer };
  }

  const parts = decodedParts(event);
  if (!parts) {
    return null;
  }
  const { topic, value } = parts;
  const amount = extractAmount(value);
  if (amount === undefined) {
    return null;
  }

  switch (topic[0]) {
    case "mint": {
      const to = subjectAfterOptionalAdmin(topic);
      return isString(to) ? { kind: "mint", from: null, to, amount, toMuxedId: extractMuxedId(value) } : null;
    }
    case "burn":
      return isString(topic[1]) ? { kind: "burn", from: topic[1], to: null, amount, toMuxedId: null } : null;
    case "clawback": {
      const from = subjectAfterOptionalAdmin(topic);
      return isString(from) ? { kind: "clawback", from, to: null, amount, toMuxedId: null } : null;
    }
    default:
      return null;
  }
}
