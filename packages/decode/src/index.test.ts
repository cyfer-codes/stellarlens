import { nativeToScVal } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { decodeScVal, tryDecodeScVal } from "./index.js";

// An scvI128 type tag with no body, so reading the i128 parts runs off the end of the buffer.
const MALFORMED_XDR = "AAAACg==";

describe("decodeScVal", () => {
  it("decodes symbols and i128 values into JSON-safe natives", () => {
    expect(decodeScVal(nativeToScVal("fee", { type: "symbol" }).toXdr("base64"))).toBe("fee");
    expect(decodeScVal(nativeToScVal(-9741n, { type: "i128" }).toXdr("base64"))).toBe("-9741");
  });

  it("throws on a malformed payload", () => {
    expect(() => decodeScVal(MALFORMED_XDR)).toThrow();
  });
});

describe("tryDecodeScVal", () => {
  it("returns the decoded value for valid input", () => {
    const result = tryDecodeScVal(nativeToScVal(42n, { type: "i128" }).toXdr("base64"));
    expect(result).toEqual({ ok: true, value: "42" });
  });

  it("returns an error result instead of throwing for malformed input", () => {
    const result = tryDecodeScVal(MALFORMED_XDR);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/incomplete XDR data/);
  });
});

function encode(value: unknown, type?: "symbol" | "string" | "i128"): string {
  return nativeToScVal(value, type ? { type } : undefined).toXdr("base64");
}

describe("decodeScVal value types", () => {
  it("decodes symbol and string values", () => {
    expect(decodeScVal(encode("transfer", "symbol"))).toBe("transfer");
    expect(decodeScVal(encode("hello", "string"))).toBe("hello");
  });

  it("converts i128 bigint values to strings", () => {
    const decoded = decodeScVal(encode(12345678901234567890n, "i128"));

    expect(decoded).toBe("12345678901234567890");
    expect(typeof decoded).toBe("string");
  });

  it("decodes vectors", () => {
    expect(decodeScVal(encode(["first", "second"]))).toEqual(["first", "second"]);
  });

  it("decodes maps", () => {
    expect(decodeScVal(encode({ key: "value" }))).toEqual({ key: "value" });
  });
});
