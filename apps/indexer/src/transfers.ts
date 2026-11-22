/**
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

export function detectTransfer(decodedTopic: unknown[], decodedValue: unknown): DetectedTransfer | undefined {
  if (
    decodedTopic.length < 3 ||
    decodedTopic[0] !== "transfer" ||
    typeof decodedTopic[1] !== "string" ||
    typeof decodedTopic[2] !== "string"
  ) {
    return undefined;
  }

  const amount = extractAmount(decodedValue);
  if (amount === undefined) {
    return undefined;
  }

  const transfer: DetectedTransfer = { from: decodedTopic[1], to: decodedTopic[2], amount };

  // SAC transfer events carry the asset identifier as a 4th topic. Only surface it when
  // it is a string; otherwise leave `asset` undefined so the caller falls back to the
  // emitting contract address.
  if (typeof decodedTopic[3] === "string") {
    transfer.asset = decodedTopic[3];
  }

  return transfer;
}

// Plain transfers carry an i128 amount as `value`; muxed transfers carry
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