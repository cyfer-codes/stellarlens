import { describe, expect, it } from "vitest";
import { formatAmount, parseAmount, I128_MAX, I128_MIN } from "./amounts.js";

describe("formatAmount", () => {
  it("formats standard amounts with 7 decimals", () => {
    expect(formatAmount(10000000n, 7)).toBe("1");
    expect(formatAmount(15000000n, 7)).toBe("1.5");
    expect(formatAmount(12345670n, 7)).toBe("1.234567");
    expect(formatAmount(1n, 7)).toBe("0.0000001");
  });

  it("formats zero correctly without negative sign", () => {
    expect(formatAmount(0n, 7)).toBe("0");
    expect(formatAmount(-0n, 7)).toBe("0");
    expect(formatAmount("0", 7)).toBe("0");
  });

  it("handles negative amounts", () => {
    expect(formatAmount(-10000000n, 7)).toBe("-1");
    expect(formatAmount(-5000000n, 7)).toBe("-0.5");
    expect(formatAmount(-1n, 7)).toBe("-0.0000001");
  });

  it("handles zero decimals (integer base units)", () => {
    expect(formatAmount(500n, 0)).toBe("500");
    expect(formatAmount(-500n, 0)).toBe("-500");
  });

  it("accepts string, number, and bigint inputs", () => {
    expect(formatAmount("25000000", 7)).toBe("2.5");
    expect(formatAmount("-25000000", 7)).toBe("-2.5");
    expect(formatAmount(25000000, 7)).toBe("2.5");
  });

  it("respects maxFractionDigits option", () => {
    expect(formatAmount(12345678n, 7, { maxFractionDigits: 2 })).toBe("1.23");
    expect(formatAmount(12345678n, 7, { maxFractionDigits: 4 })).toBe("1.2345");
    expect(formatAmount(12345678n, 7, { maxFractionDigits: 0 })).toBe("1");
    expect(formatAmount(10000000n, 7, { maxFractionDigits: 2 })).toBe("1");
  });

  it("throws on invalid decimals or maxFractionDigits", () => {
    expect(() => formatAmount(100n, -1)).toThrow(RangeError);
    expect(() => formatAmount(100n, 1.5)).toThrow(RangeError);
    expect(() => formatAmount(100n, 7, { maxFractionDigits: -1 })).toThrow(RangeError);
  });
});

describe("parseAmount", () => {
  it("parses valid decimal strings to bigint", () => {
    expect(parseAmount("1", 7)).toBe(10000000n);
    expect(parseAmount("1.5", 7)).toBe(15000000n);
    expect(parseAmount("0.0000001", 7)).toBe(1n);
    expect(parseAmount("12.34567", 7)).toBe(123456700n);
  });

  it("parses negative decimal strings", () => {
    expect(parseAmount("-1", 7)).toBe(-10000000n);
    expect(parseAmount("-0.5", 7)).toBe(-5000000n);
    expect(parseAmount("-0.0000001", 7)).toBe(-1n);
  });

  it("parses strings with zero decimals", () => {
    expect(parseAmount("500", 0)).toBe(500n);
    expect(parseAmount("-500", 0)).toBe(-500n);
  });

  it("throws on invalid decimal format", () => {
    expect(() => parseAmount("abc", 7)).toThrow("invalid decimal amount");
    expect(() => parseAmount("1.2.3", 7)).toThrow("invalid decimal amount");
    expect(() => parseAmount("", 7)).toThrow("invalid decimal amount");
  });

  it("throws when fractional digits exceed configured decimal precision", () => {
    expect(() => parseAmount("1.12345678", 7)).toThrow(RangeError);
    expect(() => parseAmount("0.1", 0)).toThrow(RangeError);
  });
});

describe("i128 extreme boundaries", () => {
  it("formats and parses I128_MAX without precision loss", () => {
    const formatted = formatAmount(I128_MAX, 7);
    expect(formatted).toBe("17014118346046923173168730371588.4105727");
    const parsed = parseAmount(formatted, 7);
    expect(parsed).toBe(I128_MAX);
  });

  it("formats and parses I128_MIN without precision loss", () => {
    const formatted = formatAmount(I128_MIN, 7);
    expect(formatted).toBe("-17014118346046923173168730371588.4105728");
    const parsed = parseAmount(formatted, 7);
    expect(parsed).toBe(I128_MIN);
  });

  it("rejects values that exceed i128 range when parsing", () => {
    // 17014118346046923173168730371588.4105728 exceeds I128_MAX by 1 base unit
    expect(() => parseAmount("17014118346046923173168730371588.4105728", 7)).toThrow(RangeError);

    // -17014118346046923173168730371588.4105729 is less than I128_MIN by 1 base unit
    expect(() => parseAmount("-17014118346046923173168730371588.4105729", 7)).toThrow(RangeError);
  });
});
