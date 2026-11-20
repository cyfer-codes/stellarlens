import Link from "next/link";
import { AccountTransferSearch } from "@/components/AccountTransferSearch";
import { EmptyState } from "@/components/ui/EmptyState";
import { listAccountTransfers } from "@/lib/api";

const PAGE_SIZE = 20;

export default async function TransfersPage({ searchParams }: { searchParams: { address?: string; cursor?: string } }) {
  const address = searchParams.address?.trim() ?? "";
  const cursor = searchParams.cursor ? Number(searchParams.cursor) : undefined;
  const transfers = address ? await listAccountTransfers(address, { cursor, limit: PAGE_SIZE }) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Account transfers</h1>
        <p className="mt-1 text-sm text-gray-500">Search transfer history across all registered tokens.</p>
      </div>
      <AccountTransferSearch address={address} />
      {address && transfers && transfers.data.length === 0 ? (
        <EmptyState title="No transfers found" description="No indexed transfers match this account." />
      ) : transfers ? (
        <div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <caption className="sr-only">Transfers involving {address}</caption>
              <thead><tr className="border-b border-gray-200 text-gray-500"><th className="py-2 font-medium">Direction</th><th className="py-2 font-medium">Counterparty</th><th className="py-2 font-medium">Amount</th><th className="py-2 font-medium">Token</th><th className="py-2 font-medium">Time</th></tr></thead>
              <tbody>{transfers.data.map((transfer) => {
                const sent = transfer.from === address;
                return <tr key={transfer.id} className="border-b border-gray-100"><td className="py-2">{sent ? "Sent" : "Received"}</td><td className="py-2 font-mono text-xs">{(sent ? transfer.to : transfer.from).slice(0, 12)}…</td><td className="py-2">{transfer.amount}</td><td className="py-2 font-mono text-xs">{transfer.asset.slice(0, 12)}…</td><td className="whitespace-nowrap py-2 text-gray-500">{new Date(transfer.createdAt).toLocaleString()}</td></tr>;
              })}</tbody>
            </table>
          </div>
          {transfers.nextCursor !== null && <Link href={`/transfers?${new URLSearchParams({ address, cursor: String(transfers.nextCursor) }).toString()}`} className="mt-4 inline-block rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white">Next page <span aria-hidden="true">→</span></Link>}
        </div>
      ) : null}
    </div>
  );
}
