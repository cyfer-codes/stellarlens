import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type DnsResolver = (hostname: string) => Promise<Array<{ address: string }>>;

export function ipv4IsPublic(address: string): boolean {
  const octets = address.split(".").map(Number);
  const [first, second, third] = octets;

  return !(
    first === 0 ||
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

export function ipv6ToBigInt(address: string): bigint {
  let normalized = address.toLowerCase();
  const ipv4Suffix = normalized.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4Suffix) {
    const octets = ipv4Suffix[1].split(".").map(Number);
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    normalized = normalized.replace(ipv4Suffix[1], `${high}:${low}`);
  }

  const [left = "", right] = normalized.split("::");
  const leftGroups = left ? left.split(":") : [];
  const rightGroups = right ? right.split(":") : [];
  const zeroGroups = Array(8 - leftGroups.length - rightGroups.length).fill("0");
  const groups = [...leftGroups, ...zeroGroups, ...rightGroups];

  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group || "0"}`), 0n);
}

export function ipIsPublic(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return ipv4IsPublic(address);
  }
  if (family !== 6) {
    return false;
  }

  const value = ipv6ToBigInt(address);
  if (value >> 32n === 0xffffn) {
    const ipv4Bytes = (value & 0xffffffffn).toString(16).padStart(8, "0").match(/.{2}/g)!;
    return ipv4IsPublic(ipv4Bytes.map((byte) => parseInt(byte, 16)).join("."));
  }

  const globalUnicast = value >> 125n === 0b001n;
  const documentation = value >> 96n === 0x20010db8n;
  const specialUse = value >> 105n === 0x100080n || value >> 112n === 0x2002n;
  return globalUnicast && !documentation && !specialUse;
}

export class NonPublicWebhookUrlError extends Error {
  constructor() {
    super("webhook URL resolves to a non-public IP address");
    this.name = "NonPublicWebhookUrlError";
  }
}

export async function assertPublicWebhookUrl(
  url: string,
  resolve: DnsResolver = (hostname) => lookup(hostname, { all: true, verbatim: true })
): Promise<void> {
  const parsed = new URL(url);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname }] : await resolve(hostname);

  if (addresses.length === 0 || addresses.some(({ address }) => !ipIsPublic(address))) {
    throw new NonPublicWebhookUrlError();
  }
}
