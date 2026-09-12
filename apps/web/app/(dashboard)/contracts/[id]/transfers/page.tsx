import Link from "next/link";
import { notFound } from "next/navigation";
import { VolumeChart } from "@/components/VolumeChart";
import { EmptyState } from "@/components/ui/EmptyState";
import { ApiNotFoundError, getContract, listTransfers } from "@/lib/api";

const PAGE_SIZE = 20;

export default async function ContractTransfersPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { cursor?: string };
}) {
  const contractId = Number(params.id);
  if (!Number.isInteger(contractId)) {
    notFound();
  }

  const cursor = searchParams.cursor ? Number(searchParams.cursor) : undefined;

  let contract;
  let transfers;
  try {
    [contract, transfers] = await Promise.all([
      getContract(contractId),
      listTransfers(contractId, { cursor, limit: PAGE_SIZE })
    ]);
  } catch (err) {
    if (err instanceof ApiNotFoundError) {
      notFound();
    }
    throw err;
  }

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/contracts/${contractId}`} className="text-sm text-gray-500 hover:underline">
          ← {contract.name ?? contract.address}
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Transfers</h1>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Volume over time</h2>
        <VolumeChart transfers={transfers.data} />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">All transfers</h2>
        {transfers.data.length === 0 ? (
          <EmptyState
            title="No transfers yet"
            description="Transfers will appear here automatically as the indexer picks up activity for this contract."
          />
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="py-2 font-medium">Ledger</th>
                <th className="py-2 font-medium">From</th>
                <th className="py-2 font-medium">To</th>
                <th className="py-2 font-medium">Amount</th>
                <th className="py-2 font-medium">Tx hash</th>
              </tr>
            </thead>
            <tbody>
              {transfers.data.map((transfer) => (
                <tr key={transfer.id} className="border-b border-gray-100">
                  <td className="py-2">{transfer.ledger}</td>
                  <td className="py-2 font-mono text-xs">{transfer.from.slice(0, 10)}…</td>
                  <td className="py-2 font-mono text-xs">{transfer.to.slice(0, 10)}…</td>
                  <td className="py-2">{transfer.amount}</td>
                  <td className="py-2 font-mono text-xs">{transfer.txHash.slice(0, 10)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {transfers.nextCursor !== null && (
          <div className="mt-4">
            <Link
              href={`/contracts/${contractId}/transfers?cursor=${transfers.nextCursor}`}
              className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Next page →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
