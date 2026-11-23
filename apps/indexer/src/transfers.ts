/**
 * Recognizes SEP-41 token movement events: `transfer`, `mint`, `burn` and `clawback`.
 * Real-world tokens don't reliably include a separate asset-code topic, so the emitting
 * contract's own address is used as the asset identifier.
 *
 * Topic layouts handled:
 * - transfer:  `["transfer", from: Address, to: Address, ...]`
 * - mint:      `["mint", to: Address]` (CAP-67) or legacy `["mint", admin, to, asset]`
 * - burn:      `["burn", from: Address, ...]`
 * - clawback:  `["clawback", from: Address, ...]` (CAP-67) or legacy `["clawback", admin, from, asset]`
 *
 * The absent side is `null`: mint has no `from`, burn/clawback have no `to`.
 * Recognizes SEP-41 `transfer` events: topics are `["transfer", from: Address, to: Address]`.
 *
 * Stellar Asset Contract (CAP-67 / SAC) transfer events additionally include a 4th topic
 * carrying the asset identifier as a string (e.g. `USDC:G...` or `native`). When present,
 * that identifier is surfaced as `asset` so the indexer stores a human-readable asset
 * instead of the opaque emitting contract address.
 *
 * Choice: we reuse the existing `asset` column rather than adding a separate `asset_code`
 * column. This keeps the transfers endpoint's `asset` filter working unchanged — callers
 * filter on the same column whether the value came from the SAC topic or fell back to the
 * emitting contract address.
 */
export type TokenMovementKind = "transfer" | "mint" | "burn" | "clawback";

export interface TokenMovement {
  kind: TokenMovementKind;
  from: string | null;
  to: string | null;
  amount: string;
  toMuxedId?: string;
}

// Backwards-compatible alias for the transfer-only shape.
export interface DetectedTransfer {
  from: string;
  to: string;
  amount: string;
  /**
   * Asset identifier taken from the optional 4th topic (`topic[3]`) of SAC transfer events.
   * `undefined` when the event has no such topic, in which case the caller falls back to
   * the emitting contract address.
   */
  asset?: string;
}

export function detectTokenMovement(
  decodedTopic: unknown[],
  decodedValue: unknown,
): TokenMovement | undefined {
  if (decodedTopic.length < 1 || typeof decodedTopic[0] !== "string") {
    return undefined;
  }

  const kind = decodedTopic[0];
  const amount = extractAmount(decodedValue);
  if (amount === undefined) {
    return undefined;
  }
  const toMuxedId = extractToMuxedId(decodedValue);

  switch (kind) {
    case "transfer": {
      if (
        decodedTopic.length < 3 ||
        typeof decodedTopic[1] !== "string" ||
        typeof decodedTopic[2] !== "string"
      ) {
        return undefined;
      }
      return withMuxed(
        { kind: "transfer", from: decodedTopic[1], to: decodedTopic[2], amount },
        toMuxedId,
      );
    }

    case "mint": {
      // CAP-67: ["mint", to]; legacy: ["mint", admin, to, asset].
      const to = resolveMintTo(decodedTopic);
      if (to === undefined) {
        return undefined;
      }
      return withMuxed({ kind: "mint", from: null, to, amount }, toMuxedId);
    }

    case "burn": {
      // ["burn", from, ...]
      if (decodedTopic.length < 2 || typeof decodedTopic[1] !== "string") {
        return undefined;
      }
      return withMuxed({ kind: "burn", from: decodedTopic[1], to: null, amount }, toMuxedId);
    }

    case "clawback": {
      // CAP-67: ["clawback", from, ...]; legacy: ["clawback", admin, from, asset].
      const from = resolveClawbackFrom(decodedTopic);
      if (from === undefined) {
        return undefined;
      }
      return withMuxed({ kind: "clawback", from, to: null, amount }, toMuxedId);
    }

    default:
      return undefined;
  }
}

/**
 * Backwards-compatible wrapper: returns the transfer shape only when the event is a
 * `transfer`, otherwise `undefined`.
 */
export function detectTransfer(
  decodedTopic: unknown[],
  decodedValue: unknown,
): DetectedTransfer | undefined {
  const movement = detectTokenMovement(decodedTopic, decodedValue);
  if (!movement || movement.kind !== "transfer" || movement.from === null || movement.to === null) {
    return undefined;
  }
  return { from: movement.from, to: movement.to, amount: movement.amount };
  const transfer: DetectedTransfer = { from: decodedTopic[1], to: decodedTopic[2], amount };

  // SAC transfer events carry the asset identifier as a 4th topic. Only surface it when
  // it is a string; otherwise leave `asset` undefined so the caller falls back to the
  // emitting contract address.
  if (typeof decodedTopic[3] === "string") {
    transfer.asset = decodedTopic[3];
  }

  return transfer;
}

// CAP-67 mint is ["mint", to]; legacy mint is ["mint", admin, to, asset].
function resolveMintTo(decodedTopic: unknown[]): string | undefined {
  if (decodedTopic.length >= 4) {
    // Legacy layout: index 2 is the recipient.
    return typeof decodedTopic[2] === "string" ? decodedTopic[2] : undefined;
  }
  if (decodedTopic.length >= 2 && typeof decodedTopic[1] === "string") {
    return decodedTopic[1];
  }
  return undefined;
}

// CAP-67 clawback is ["clawback", from, ...]; legacy clawback is ["clawback", admin, from, asset].
function resolveClawbackFrom(decodedTopic: unknown[]): string | undefined {
  if (decodedTopic.length >= 4) {
    // Legacy layout: index 2 is the source being clawed back.
    return typeof decodedTopic[2] === "string" ? decodedTopic[2] : undefined;
  }
  if (decodedTopic.length >= 2 && typeof decodedTopic[1] === "string") {
    return decodedTopic[1];
  }
  return undefined;
}

function withMuxed(movement: TokenMovement, toMuxedId: string | undefined): TokenMovement {
  if (toMuxedId !== undefined) {
    movement.toMuxedId = toMuxedId;
  }
  return movement;
}

// Plain movements carry an i128 amount as `value`; muxed movements carry
// `{ amount, to_muxed_id }` instead.
function extractAmount(decodedValue: unknown): string | undefined {
  if (typeof decodedValue === "string") {
    return decodedValue;
  }
  if (decodedValue && typeof decodedValue === "object" && "amount" in decodedValue) {
    const amount = (decodedValue as { amount: unknown }).amount;
    return typeof amount === "string" ? amount : undefined;
  }
  return undefined;
}

function extractToMuxedId(decodedValue: unknown): string | undefined {
  if (decodedValue && typeof decodedValue === "object" && "to_muxed_id" in decodedValue) {
    const muxedId = (decodedValue as { to_muxed_id: unknown }).to_muxed_id;
    if (typeof muxedId === "string") {
      return muxedId;
    }
    if (typeof muxedId === "number" || typeof muxedId === "bigint") {
      return muxedId.toString();
    }
  }
  return undefined;
}