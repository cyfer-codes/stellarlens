import { Readable } from "node:stream";
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { decodeScVal } from "@stellarlens/decode";
import { describe, expect, it } from "vitest";
import { decodeXdr, InvalidXdrError, runDecode } from "./decode.js";

function encode(value: unknown, type?: "symbol" | "string" | "i128" | "u64"): string {
  return nativeToScVal(value, type ? { type } : undefined).toXdr("base64");
}

function stdinOf(text: string, isTTY = false) {
  return Object.assign(Readable.from([Buffer.from(text)]), { isTTY });
}

describe("decodeXdr", () => {
  it("prints scalars as JSON", () => {
    expect(decodeXdr(encode("transfer", "symbol"))).toBe('"transfer"');
    expect(decodeXdr(encode(-9741n, "i128"))).toBe('"-9741"');
    expect(decodeXdr(xdr.ScVal.scvVoid().toXdr("base64"))).toBe("null");
    expect(decodeXdr(xdr.ScVal.scvBool(true).toXdr("base64"))).toBe("true");
  });

  it("pretty-prints nested maps and vectors", () => {
    const value = encode({ amount: 10n, to: ["a", "b"] });

    expect(decodeXdr(value)).toBe(JSON.stringify(decodeScVal(value), null, 2));
    expect(JSON.parse(decodeXdr(value))).toEqual({ amount: "10", to: ["a", "b"] });
  });

  it("matches the indexer's decoding exactly", () => {
    const samples = [encode(12345678901234567890n, "i128"), encode(7n, "u64"), encode(["x", { k: "v" }])];
    for (const sample of samples) {
      expect(JSON.parse(decodeXdr(sample))).toEqual(decodeScVal(sample));
    }
  });

  it("ignores surrounding and embedded whitespace", () => {
    const value = encode("hello", "string");
    expect(decodeXdr(`  ${value.slice(0, 6)}\n${value.slice(6)}\n`)).toBe('"hello"');
  });

  it.each([
    ["empty input", "   ", /input is empty/],
    ["non-base64 input", "not base64!", /invalid XDR: invalid base64/],
    ["truncated XDR", "AAAACg==", /invalid XDR: .*incomplete XDR data/],
    ["an unknown ScVal type", "aGVsbG8gd29ybGQ=", /invalid XDR: .*unknown enum value/],
    ["trailing garbage", `${encode(1n, "i128")}AAAA`, /invalid XDR/]
  ])("throws InvalidXdrError for %s", (_label, input, message) => {
    expect(() => decodeXdr(input)).toThrow(InvalidXdrError);
    expect(() => decodeXdr(input)).toThrow(message);
  });
});

describe("runDecode", () => {
  it("decodes the positional argument", async () => {
    const lines: string[] = [];
    await runDecode(encode("fee", "symbol"), { log: (line) => lines.push(line), stdin: stdinOf("") });
    expect(lines).toEqual(['"fee"']);
  });

  it.each([undefined, "-"])("reads from stdin when the argument is %j", async (arg) => {
    const lines: string[] = [];
    await runDecode(arg, { log: (line) => lines.push(line), stdin: stdinOf(`${encode(42n, "i128")}\n`) });
    expect(lines).toEqual(['"42"']);
  });

  it("explains how to pass input instead of hanging on an interactive terminal", async () => {
    await expect(runDecode(undefined, { stdin: stdinOf("", true), log: () => {} })).rejects.toThrow(
      /pass base64 XDR as an argument or pipe it on stdin/
    );
  });
});
