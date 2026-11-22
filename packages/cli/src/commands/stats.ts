import type { ContractStats, StellarLensClient } from "@stellarlens/sdk";

export interface StatsOptions {
  /** Window start (ISO 8601). */
  from?: string;
  /** Window end (ISO 8601). */
  to?: string;
}

export function formatStats(contractId: number, stats: ContractStats, options: StatsOptions = {}): string[] {
  const window =
    options.from || options.to ? ` (${options.from ?? "beginning"} → ${options.to ?? "now"})` : "";
  const lines = [
    `stats for contract ${contractId}${window}`,
    `transfers:        ${stats.transferCount}`,
    `unique senders:   ${stats.uniqueSenders}`,
    `unique receivers: ${stats.uniqueReceivers}`
  ];

  if (stats.volumeByAsset.length === 0) {
    lines.push("volume by asset:  —");
  } else {
    lines.push("volume by asset:");
    for (const { asset, volume } of stats.volumeByAsset) {
      lines.push(`  ${asset}: ${volume}`);
    }
  }
  return lines;
}

/** Prints a contract's transfer stats, optionally scoped to a `--from`/`--to` window. */
export async function showStats(
  client: StellarLensClient,
  contractId: number,
  options: StatsOptions = {}
): Promise<void> {
  const stats = await client.getStats(contractId, { from: options.from, to: options.to });
  for (const line of formatStats(contractId, stats, options)) {
    console.log(line);
  }
}
