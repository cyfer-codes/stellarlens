import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
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

function encode(value: unknown, type?: "symbol" | "string" | "i128" | "bytes"): string {
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

  it("decodes Bytes values to hex strings instead of index-keyed objects", () => {
    const raw = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
    const scBytes = xdr.ScVal.scvBytes(raw);
    const decoded = decodeScVal(scBytes.toXdr("base64"));

    expect(decoded).toBe("000102fffe");
    expect(typeof decoded).toBe("string");
    expect(typeof decoded).not.toBe("object");
  });

  it("decodes BytesN<32> values to 64-character hex strings", () => {
    const raw = Buffer.alloc(32, 0xab);
    const scBytesN = xdr.ScVal.scvBytes(raw);
    const decoded = decodeScVal(scBytesN.toXdr("base64"));

    expect(decoded).toBe("ab".repeat(32));
    expect((decoded as string).length).toBe(64);
  });

  it("decodes Bytes nested inside vectors and maps", () => {
    const b1 = Buffer.from([0xde, 0xad]);
    const b2 = Buffer.from([0xbe, 0xef]);

    const vecVal = xdr.ScVal.scvVec([xdr.ScVal.scvBytes(b1), xdr.ScVal.scvBytes(b2)]);
    expect(decodeScVal(vecVal.toXdr("base64"))).toEqual(["dead", "beef"]);

    const mapVal = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("hash"),
        val: xdr.ScVal.scvBytes(b1)
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("signature"),
        val: xdr.ScVal.scvBytes(b2)
      })
    ]);
    expect(decodeScVal(mapVal.toXdr("base64"))).toEqual({
      hash: "dead",
      signature: "beef"
    });
  });
});
