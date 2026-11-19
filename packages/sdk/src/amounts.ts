/**
 * Minimum signed 128-bit integer value: -2^127
 */
export const I128_MIN = -(2n ** 127n);

/**
 * Maximum signed 128-bit integer value: 2^127 - 1
 */
export const I128_MAX = 2n ** 127n - 1n;

export interface FormatAmountOptions {
  /**
   * Maximum number of decimal places to include in the output string.
   * If specified, the fractional part is truncated to this length.
   */
  maxFractionDigits?: number;
}

/**
 * Formats a base-unit amount (in bigint or decimal string) into a human-readable display string
 * without precision loss, supporting negative values and custom decimal scales.
 *
 * @param amount Base-unit amount as a bigint, string, or integer number
 * @param decimals Decimal places of the asset (default: 7, matching Stellar Lumens / Soroban standard)
 * @param options Formatting options, e.g. maxFractionDigits
 * @returns Human-readable decimal string
 */
export function formatAmount(
  amount: bigint | string | number,
  decimals = 7,
  options?: FormatAmountOptions
): string {
  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new RangeError(`decimals must be a non-negative integer; received ${decimals}`);
  }

  const raw = typeof amount === "bigint" ? amount : BigInt(String(amount));
  const isNegative = raw < 0n;
  const abs = isNegative ? -raw : raw;

  if (abs === 0n) {
    return "0";
  }

  if (decimals === 0) {
    return `${isNegative ? "-" : ""}${abs.toString()}`;
  }

  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = abs % base;

  let fractionStr = fraction.toString().padStart(decimals, "0");

  if (options?.maxFractionDigits !== undefined) {
    if (options.maxFractionDigits < 0 || !Number.isInteger(options.maxFractionDigits)) {
      throw new RangeError(
        `maxFractionDigits must be a non-negative integer; received ${options.maxFractionDigits}`
      );
    }
    fractionStr = fractionStr.slice(0, options.maxFractionDigits);
  }

  fractionStr = fractionStr.replace(/0+$/, "");

  const formatted =
    fractionStr.length > 0 ? `${whole.toString()}.${fractionStr}` : whole.toString();

  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Parses a human-readable decimal string into a base-unit bigint without precision loss.
 * Validates that the resulting value fits within the signed 128-bit integer range.
 *
 * @param display Human-readable display string (e.g. "12.345" or "-0.05")
 * @param decimals Decimal places of the asset (default: 7)
 * @returns Base-unit integer as a bigint
 */
export function parseAmount(display: string, decimals = 7): bigint {
  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new RangeError(`decimals must be a non-negative integer; received ${decimals}`);
  }

  const str = String(display).trim();
  if (!/^[-+]?\d+(\.\d+)?$/.test(str)) {
    throw new Error(`invalid decimal amount: "${display}"`);
  }

  const isNegative = str.startsWith("-");
  const clean = str.replace(/^[-+]/, "");
  const [wholePart, fracPart = ""] = clean.split(".");

  if (fracPart.length > decimals) {
    throw new RangeError(
      `fractional part "${fracPart}" exceeds configured decimal precision of ${decimals} places`
    );
  }

  const paddedFrac = fracPart.padEnd(decimals, "0");
  const baseUnits =
    BigInt(wholePart) * 10n ** BigInt(decimals) + (paddedFrac ? BigInt(paddedFrac) : 0n);

  const signed = isNegative ? -baseUnits : baseUnits;

  if (signed < I128_MIN || signed > I128_MAX) {
    throw new RangeError(`parsed amount is outside the signed i128 range: ${signed.toString()}`);
  }

  return signed;
}
