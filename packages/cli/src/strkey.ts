/**
 * Minimal, dependency-free Stellar strkey validation for the CLI.
 *
 * Mirrors the api's `isValidStellarAddress` (StrKey.isValidContract ||
 * StrKey.isValidEd25519PublicKey from @stellar/stellar-sdk) without pulling
 * the full stellar sdk into the CLI: a strkey is base32 (RFC 4648, no padding)
 * of `versionByte | 32-byte payload | CRC16-XModem(versionByte | payload)`,
 * with the checksum stored little-endian.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Version bytes for the two address kinds the api accepts. */
const VERSION_BYTES = {
  ed25519PublicKey: 6 << 3, // "G..."
  contract: 2 << 3 // "C..."
} as const;

// 1 version byte + 32 payload bytes + 2 checksum bytes = 35 bytes = 56 base32 chars, no padding.
const DECODED_LENGTH = 35;
const ENCODED_LENGTH = 56;

function base32Decode(input: string): Uint8Array | null {
  const out = new Uint8Array(Math.floor((input.length * 5) / 8));
  let buffer = 0;
  let bits = 0;
  let index = 0;

  for (const char of input) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) {
      return null;
    }
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >> bits) & 0xff;
    }
  }

  return out;
}

function crc16Xmodem(bytes: Uint8Array): number {
  let crc = 0x0000;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function isValidStrkey(value: string, versionByte: number): boolean {
  if (value.length !== ENCODED_LENGTH) {
    return false;
  }

  const decoded = base32Decode(value);
  if (!decoded || decoded.length !== DECODED_LENGTH || decoded[0] !== versionByte) {
    return false;
  }

  const expected = crc16Xmodem(decoded.subarray(0, DECODED_LENGTH - 2));
  const actual = decoded[DECODED_LENGTH - 2] | (decoded[DECODED_LENGTH - 1] << 8);
  return expected === actual;
}

/** True for a well-formed Soroban contract (C...) or account (G...) strkey. */
export function isValidStellarAddress(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (isValidStrkey(value, VERSION_BYTES.contract) ||
      isValidStrkey(value, VERSION_BYTES.ed25519PublicKey))
  );
}
