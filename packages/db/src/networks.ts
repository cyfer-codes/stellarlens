/**
 * Stellar networks supported by the indexer and contract registry API.
 * Keep this list in the shared database package so every workspace validates
 * network names against the same source of truth.
 */
export const STELLAR_NETWORKS = ["testnet", "futurenet", "mainnet", "standalone"] as const;

export type StellarNetwork = (typeof STELLAR_NETWORKS)[number];

export function isStellarNetwork(value: string): value is StellarNetwork {
  return (STELLAR_NETWORKS as readonly string[]).includes(value);
}
