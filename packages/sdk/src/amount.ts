/**
 * Precision-safe helpers for token amounts.
 *
 * The api returns amounts (`TransferRecord.amount`, `ContractStats.volumeByAsset[].volume`) as decimal
 * strings in the token's base units, because Soroban token amounts are i128 and routinely exceed
 * `Number.MAX_SAFE_INTEGER`. Converting them with `Number(...)` silently loses precision, so these
 * helpers do all arithmetic with `bigint` instead.
 */

export interface FormatAmountOptions {
  /**
   * Maximum number of fraction digits to show. Extra digits are rounded half away from zero (the same
   * rule as `Intl.NumberFormat`'s default). Defaults to `decimals`, i.e. no rounding.
   */
  maxFractionDigits?: number;
}

const INTEGER_PATTERN = /^[+-]?\d+$/;
const DECIMAL_PATTERN = /^([+-])?(\d*)(?:\.(\d*))?$/;

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
}

function toBigInt(amount: string | bigint): bigint {
  if (typeof amount === "bigint") {
    return amount;
  }
  const trimmed = amount.trim();
  if (!INTEGER_PATTERN.test(trimmed)) {
    throw new SyntaxError(`amount must be an integer string in base units, got "${amount}"`);
  }
  return BigInt(trimmed);
}

/**
 * Formats an amount in base units as a human-readable decimal string, e.g.
 * `formatAmount("12345678", 7) === "1.2345678"`.
 *
 * Trailing fraction zeros are trimmed (`"10000000"` with 7 decimals is `"1"`), and no grouping separators
 * are added, so the output is safe to feed back into {@link parseAmount}. Use `Intl.NumberFormat` on the
 * result only if you accept its float precision for display.
 *
 * @param amount   Base-unit amount as an integer string (as returned by the api) or a `bigint`.
 * @param decimals Number of decimals the token uses (7 for Stellar asset contracts).
 */
export function formatAmount(
  amount: string | bigint,
  decimals: number,
  options: FormatAmountOptions = {}
): string {
  assertNonNegativeInteger(decimals, "decimals");
  const maxFractionDigits = options.maxFractionDigits ?? decimals;
  assertNonNegativeInteger(maxFractionDigits, "maxFractionDigits");

  const value = toBigInt(amount);
  const negative = value < 0n;
  let magnitude = negative ? -value : value;
  let fractionDigits = decimals;

  if (maxFractionDigits < decimals) {
    const divisor = 10n ** BigInt(decimals - maxFractionDigits);
    const remainder = magnitude % divisor;
    magnitude /= divisor;
    if (remainder * 2n >= divisor) {
      magnitude += 1n;
    }
    fractionDigits = maxFractionDigits;
  }

  const scale = 10n ** BigInt(fractionDigits);
  const whole = magnitude / scale;
  const fraction =
    fractionDigits > 0
      ? (magnitude % scale).toString().padStart(fractionDigits, "0").replace(/0+$/, "")
      : "";

  // Rounding can turn a small negative amount into zero; never print "-0".
  const sign = negative && magnitude !== 0n ? "-" : "";
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Parses a human-readable decimal string into base units, e.g. `parseAmount("1.5", 7) === 15000000n`.
 *
 * Accepts an optional leading sign, and an optional fraction (`"1"`, `"-0.25"`, `".5"`, `"2."`).
 * Throws a `RangeError` rather than rounding when the input has more significant fraction digits than the
 * token supports, since silently dropping value is never what you want when building a transaction or
 * a filter. Trailing fraction zeros beyond `decimals` are fine (`"1.50"` with 1 decimal is `15n`).
 *
 * @returns The amount in base units. Use `String(result)` to pass it where the api expects a string.
 */
export function parseAmount(display: string, decimals: number): bigint {
  assertNonNegativeInteger(decimals, "decimals");

  const trimmed = display.trim();
  const match = DECIMAL_PATTERN.exec(trimmed);
  const [, sign, wholeDigits = "", rawFraction = ""] = match ?? [];
  if (!match || (wholeDigits === "" && rawFraction === "")) {
    throw new SyntaxError(`"${display}" is not a valid decimal amount`);
  }

  const fractionDigits = rawFraction.replace(/0+$/, "");
  if (fractionDigits.length > decimals) {
    throw new RangeError(
      `"${display}" has ${fractionDigits.length} fraction digits, but the token only supports ${decimals}`
    );
  }

  const scale = 10n ** BigInt(decimals);
  const whole = BigInt(wholeDigits || "0");
  const fraction = BigInt(fractionDigits.padEnd(decimals, "0") || "0");
  const magnitude = whole * scale + fraction;
  return sign === "-" ? -magnitude : magnitude;
}
