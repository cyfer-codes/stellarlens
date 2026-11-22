import { describe, expect, it } from "vitest";
import { formatAmount, parseAmount } from "./amount.js";

const I128_MAX = 2n ** 127n - 1n; // 170141183460469231731687303715884105727
const I128_MIN = -(2n ** 127n); // -170141183460469231731687303715884105728

describe("formatAmount", () => {
  it("formats base units with the token's decimals", () => {
    expect(formatAmount("12345678", 7)).toBe("1.2345678");
    expect(formatAmount("10000000", 7)).toBe("1");
    expect(formatAmount("1", 7)).toBe("0.0000001");
    expect(formatAmount("0", 7)).toBe("0");
    expect(formatAmount("1500", 2)).toBe("15");
    expect(formatAmount("1550", 2)).toBe("15.5");
  });

  it("accepts bigint input and zero decimals", () => {
    expect(formatAmount(42n, 0)).toBe("42");
    expect(formatAmount(-42n, 0)).toBe("-42");
  });

  it("handles negative amounts", () => {
    expect(formatAmount("-12345678", 7)).toBe("-1.2345678");
    expect(formatAmount("-1", 7)).toBe("-0.0000001");
  });

  it("rounds half away from zero when maxFractionDigits is smaller than decimals", () => {
    expect(formatAmount("12345678", 7, { maxFractionDigits: 2 })).toBe("1.23");
    expect(formatAmount("12500000", 7, { maxFractionDigits: 1 })).toBe("1.3");
    expect(formatAmount("-12500000", 7, { maxFractionDigits: 1 })).toBe("-1.3");
    expect(formatAmount("12499999", 7, { maxFractionDigits: 1 })).toBe("1.2");
    expect(formatAmount("19999999", 7, { maxFractionDigits: 2 })).toBe("2");
    expect(formatAmount("19999999", 7, { maxFractionDigits: 0 })).toBe("2");
  });

  it("never prints -0 when a negative amount rounds to zero", () => {
    expect(formatAmount("-1", 7, { maxFractionDigits: 2 })).toBe("0");
  });

  it("ignores maxFractionDigits larger than decimals", () => {
    expect(formatAmount("15", 1, { maxFractionDigits: 5 })).toBe("1.5");
  });

  it("formats i128 extremes without losing precision", () => {
    expect(formatAmount(I128_MAX, 7)).toBe("17014118346046923173168730371588.4105727");
    expect(formatAmount(I128_MIN, 7)).toBe("-17014118346046923173168730371588.4105728");
    expect(formatAmount(I128_MAX.toString(), 0)).toBe("170141183460469231731687303715884105727");
    expect(formatAmount(I128_MIN.toString(), 38)).toBe("-1.70141183460469231731687303715884105728");
    expect(formatAmount(I128_MAX, 7, { maxFractionDigits: 2 })).toBe("17014118346046923173168730371588.41");
  });

  it("rejects non-integer amounts and invalid options", () => {
    expect(() => formatAmount("1.5", 7)).toThrow(SyntaxError);
    expect(() => formatAmount("1e7", 7)).toThrow(SyntaxError);
    expect(() => formatAmount("", 7)).toThrow(SyntaxError);
    expect(() => formatAmount("1", -1)).toThrow(RangeError);
    expect(() => formatAmount("1", 1.5)).toThrow(RangeError);
    expect(() => formatAmount("1", 7, { maxFractionDigits: -1 })).toThrow(RangeError);
  });
});

describe("parseAmount", () => {
  it("parses decimal strings into base units", () => {
    expect(parseAmount("1.2345678", 7)).toBe(12345678n);
    expect(parseAmount("1", 7)).toBe(10000000n);
    expect(parseAmount("0.0000001", 7)).toBe(1n);
    expect(parseAmount(".5", 1)).toBe(5n);
    expect(parseAmount("2.", 1)).toBe(20n);
    expect(parseAmount("  3.5  ", 1)).toBe(35n);
    expect(parseAmount("+3.5", 1)).toBe(35n);
    expect(parseAmount("0", 0)).toBe(0n);
  });

  it("handles negative amounts", () => {
    expect(parseAmount("-1.5", 7)).toBe(-15000000n);
    expect(parseAmount("-0.0000001", 7)).toBe(-1n);
    expect(parseAmount("-0", 7)).toBe(0n);
  });

  it("allows trailing zeros beyond decimals but rejects precision loss", () => {
    expect(parseAmount("1.50000000000", 1)).toBe(15n);
    expect(() => parseAmount("1.00000001", 7)).toThrow(RangeError);
    expect(() => parseAmount("1.5", 0)).toThrow(RangeError);
  });

  it("parses i128 extremes without losing precision", () => {
    expect(parseAmount("17014118346046923173168730371588.4105727", 7)).toBe(I128_MAX);
    expect(parseAmount("-17014118346046923173168730371588.4105728", 7)).toBe(I128_MIN);
    expect(parseAmount("170141183460469231731687303715884105727", 0)).toBe(I128_MAX);
  });

  it("round-trips with formatAmount", () => {
    for (const value of [I128_MIN, I128_MIN + 1n, -1n, 0n, 1n, 123456789n, I128_MAX - 1n, I128_MAX]) {
      for (const decimals of [0, 1, 7, 18, 38]) {
        expect(parseAmount(formatAmount(value, decimals), decimals)).toBe(value);
      }
    }
  });

  it("rejects malformed input", () => {
    for (const input of ["", " ", ".", "-", "1,000", "1e7", "abc", "1.2.3", "--1", "0x10", "1_000"]) {
      expect(() => parseAmount(input, 7), input).toThrow(SyntaxError);
    }
    expect(() => parseAmount("1", -1)).toThrow(RangeError);
  });
});
