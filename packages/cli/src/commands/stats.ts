import type { StellarLensClient } from "@stellarlens/sdk";

export interface ShowStatsOptions {
  from?: string;
  to?: string;
}

/**
 * Fetches and prints transfer summary stats for a contract (#28).
 */
export async function showStats(
  client: StellarLensClient,
  contractId: number,
  options: ShowStatsOptions = {}
): Promise<void> {
  const stats = await client.getStats(contractId, {
    from: options.from,
    to: options.to
  });

  console.log(`Transfer count:   ${stats.transferCount}`);
  console.log(`Unique senders:   ${stats.uniqueSenders}`);
  console.log(`Unique receivers: ${stats.uniqueReceivers}`);

  if (stats.volumeByAsset.length === 0) {
    console.log("Volume by asset:  none");
    return;
  }

  console.table(
    stats.volumeByAsset.map((entry) => ({
      asset: entry.asset,
      volume: entry.volume
    }))
  );
}
