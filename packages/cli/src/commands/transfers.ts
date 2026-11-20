import type { StellarLensClient, TransferRecord } from "@stellarlens/sdk";

export interface ListTransfersOptions {
  limit?: number;
  cursor?: number;
}

export function formatTransferRow(transfer: TransferRecord): Record<string, string | number> {
  return {
    id: transfer.id,
    ledger: transfer.ledger,
    from: transfer.from,
    to: transfer.to,
    amount: transfer.amount,
    asset: transfer.asset,
    txHash: transfer.txHash
  };
}

/**
 * Prints one cursor-paginated page of a contract's token transfers (#27).
 */
export async function listTransfers(
  client: StellarLensClient,
  contractId: number,
  options: ListTransfersOptions = {}
): Promise<void> {
  const page = await client.listTransfers(contractId, {
    cursor: options.cursor,
    limit: options.limit
  });

  if (page.data.length === 0) {
    console.log("No transfers found.");
    return;
  }

  console.table(page.data.map(formatTransferRow));
  if (page.nextCursor !== null) {
    console.log(`more transfers available: fetch the next page with --cursor ${page.nextCursor}`);
  }
}
