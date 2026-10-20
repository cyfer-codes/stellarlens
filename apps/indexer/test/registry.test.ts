import { createHash } from "node:crypto";
import { StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { assertValidStellarAddress } from "../src/registry.js";

/** A known-valid, checksummed contract (C...) strkey derived from a label. */
function contractAddress(label: string): string {
  return StrKey.encodeContract(createHash("sha256").update(label).digest());
}

// A real, valid Ed25519 account (G...) strkey taken from Stellar's own docs.
const VALID_ACCOUNT =
  "GCM5WPR4DDR24FSAX5LIEM4J7AI3KOWJYANSXEPKYXCSZOTAYXE75AFN";

describe("assertValidStellarAddress", () => {
  it("accepts a valid contract (C...) strkey", () => {
    const address = contractAddress("UNIT_TEST_CONTRACT");
    expect(() => assertValidStellarAddress(address)).not.toThrow();
  });

  it("accepts a valid account (G...) strkey", () => {
    expect(() => assertValidStellarAddress(VALID_ACCOUNT)).not.toThrow();
  });

  it("rejects a clearly malformed address with a descriptive error", () => {
    expect(() => assertValidStellarAddress("not-an-address")).toThrow(
      /invalid Stellar address: "not-an-address"/
    );
  });

  it("rejects an empty string", () => {
    expect(() => assertValidStellarAddress("")).toThrow(/address is required/);
  });

  it("rejects a string that looks like a strkey but has a bad checksum", () => {
    // 56 chars starting with C, but the checksum won't validate.
    expect(() => assertValidStellarAddress(`C${"A".repeat(55)}`)).toThrow(/invalid Stellar address/);
  });

  it("rejects a lowercase-looking contract address (strkeys are base32)", () => {
    expect(() => assertValidStellarAddress(`c${"A".repeat(55)}`)).toThrow(/invalid Stellar address/);
  });
});
