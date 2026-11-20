import { describe, expect, it } from "vitest";
import { isValidStellarAddress } from "./strkey.js";

// Generated with @stellar/stellar-sdk's StrKey.encodeContract / encodeEd25519PublicKey.
const CONTRACT = "CDFJPAISZIN33SX2YIY3HGRD3RG2PBXP7AKHYTTSXGAHPBNP5ZELWMKI";
const ACCOUNT = "GDGQVKMFMFD3NRNU74VX37XF3IQKUOBFGCM66G2KMSWO2IZ4TL7CSFUG";
const SECRET_SEED = "SACDU4MHOTCXFPMKEWW35MN7ZVOAEVVOCHHM7H44H6JF2DSSX2XYSVFH";

describe("isValidStellarAddress", () => {
  it("accepts contract and account strkeys", () => {
    expect(isValidStellarAddress(CONTRACT)).toBe(true);
    expect(isValidStellarAddress(ACCOUNT)).toBe(true);
  });

  it("rejects a strkey with a bad checksum", () => {
    const tampered = CONTRACT.slice(0, 10) + (CONTRACT[10] === "A" ? "B" : "A") + CONTRACT.slice(11);
    expect(isValidStellarAddress(tampered)).toBe(false);
  });

  it("rejects other strkey kinds, such as secret seeds", () => {
    expect(isValidStellarAddress(SECRET_SEED)).toBe(false);
  });

  it("rejects wrong lengths, lowercase, padding, and non-strings", () => {
    expect(isValidStellarAddress(CONTRACT.slice(0, -1))).toBe(false);
    expect(isValidStellarAddress(`${CONTRACT}A`)).toBe(false);
    expect(isValidStellarAddress(CONTRACT.toLowerCase())).toBe(false);
    expect(isValidStellarAddress(`${CONTRACT.slice(0, -1)}=`)).toBe(false);
    expect(isValidStellarAddress("")).toBe(false);
    expect(isValidStellarAddress("C1")).toBe(false);
    expect(isValidStellarAddress(undefined)).toBe(false);
    expect(isValidStellarAddress(42)).toBe(false);
  });
});
