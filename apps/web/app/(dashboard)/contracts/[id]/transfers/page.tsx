import Link from "next/link";
import { notFound } from "next/navigation";
import { ExportTransfersButton } from "@/components/ExportTransfersButton";
import { TransferFilters, type TransferFilterValues } from "@/components/TransferFilters";
import { VolumeChart } from "@/components/VolumeChart";
import { TransfersPageSizeSelect } from "@/components/TransfersPageSizeSelect";
import { EmptyState } from "@/components/ui/EmptyState";
import { ApiNotFoundError, getContract, listTransfers } from "@/lib/api";
import {
  DEFAULT_TRANSFER_PAGE_SIZE,
  TRANSFER_PAGE_SIZES,
  firstPageState,
  nextPageState,
  parseCursor,
  parseCursorHistory,
  parsePageSize,
  previousPageState,
  transfersPageHref,
  withPageSize,
  type TransfersPageState
} from "@/lib/transfersPagination";

const SECONDARY_BUTTON =
  "rounded border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800";

export default async function ContractTransfersPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: TransferFilterValues & { cursor?: string; limit?: string; prev?: string };
}) {
  const contractId = Number(params.id);
  if (!Number.isInteger(contractId)) {
    notFound();
  }

  const cursor = parseCursor(searchParams.cursor);
  const limit = parsePageSize(searchParams.limit);
  const filters: TransferFilterValues = {
    asset: searchParams.asset,
    from: searchParams.from,
    to: searchParams.to,
    minAmount: searchParams.minAmount,
    maxAmount: searchParams.maxAmount
  };
  const hasFilters = Object.values(filters).some((value) => Boolean(value));

  // `prev` only means something on a page with a cursor; ignore it on the first page.
  const pageState: TransfersPageState = {
    filters,
    limit,
    cursor,
    history: cursor === undefined ? [] : parseCursorHistory(searchParams.prev)
  };
  const isFirstPage = cursor === undefined;
  const previousPage = previousPageState(pageState);
  // Known only when we start from page 1 or carry the full history (old cursor-only deep links don't).
  const pageNumber = isFirstPage ? 1 : pageState.history.length > 0 ? pageState.history.length + 1 : null;

  let contract;
  let transfers;
  try {
    [contract, transfers] = await Promise.all([
      getContract(contractId),
      listTransfers(contractId, { cursor, limit, ...filters })
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
        <TransferFilters values={filters} limit={limit === DEFAULT_TRANSFER_PAGE_SIZE ? undefined : limit} />
      </div>

      <div>
        <Link href={`/contracts/${contractId}`} className="text-sm text-gray-500 dark:text-gray-400 hover:underline">
          <span aria-hidden="true">←</span> {contract.name ?? contract.address}
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Transfers</h1>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Volume over time</h2>
        <VolumeChart transfers={transfers.data} />
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">All transfers</h2>
          {transfers.data.length > 0 && <ExportTransfersButton contractId={contractId} filters={filters} />}
        </div>
        {transfers.data.length === 0 ? (
          isFirstPage ? (
            <EmptyState
              title={hasFilters ? "No transfers match these filters" : "No transfers yet"}
              description={
                hasFilters
                  ? "Try widening or clearing the filters above."
                  : "Transfers will appear here automatically as the indexer picks up activity for this contract."
              }
            />
          ) : (
            <EmptyState
              title="No more transfers"
              description="This page is past the end of the results."
              action={
                <Link href={transfersPageHref(contractId, firstPageState(pageState))} className={SECONDARY_BUTTON}>
                  Back to the first page
                </Link>
              }
            />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <caption className="sr-only">
                Transfers for {contract.name ?? contract.address} with ledger, sender, recipient,
                amount and transaction hash
              </caption>
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                  <th scope="col" className="py-2 font-medium">Ledger</th>
                  <th scope="col" className="py-2 font-medium">From</th>
                  <th scope="col" className="py-2 font-medium">To</th>
                  <th scope="col" className="py-2 font-medium">Amount</th>
                  <th scope="col" className="py-2 font-medium">Tx hash</th>
                </tr>
              </thead>
              <tbody>
                {transfers.data.map((transfer) => (
                  <tr key={transfer.id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2">{transfer.ledger}</td>
                    <td className="py-2 font-mono text-xs">{transfer.from.slice(0, 10)}…</td>
                    <td className="py-2 font-mono text-xs">{transfer.to.slice(0, 10)}…</td>
                    <td className="py-2">{transfer.amount}</td>
                    <td className="py-2 font-mono text-xs">{transfer.txHash.slice(0, 10)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <nav
          aria-label="Transfers pagination"
          className="mt-4 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            {previousPage ? (
              <Link href={transfersPageHref(contractId, previousPage)} rel="prev" className={SECONDARY_BUTTON}>
                <span aria-hidden="true">←</span> Previous
              </Link>
            ) : (
              // Deep-linked into a later page without history: the way back is the first page.
              !isFirstPage && (
                <Link href={transfersPageHref(contractId, firstPageState(pageState))} className={SECONDARY_BUTTON}>
                  <span aria-hidden="true">«</span> First page
                </Link>
              )
            )}
            {pageNumber !== null && (
              <span className="px-1 text-sm text-gray-500 dark:text-gray-400" aria-current="page">
                Page {pageNumber}
              </span>
            )}
            {transfers.nextCursor !== null && (
              <Link
                href={transfersPageHref(contractId, nextPageState(pageState, transfers.nextCursor))}
                rel="next"
                className="rounded bg-gray-900 dark:bg-gray-100 px-4 py-2 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200"
              >
                Next page <span aria-hidden="true">→</span>
              </Link>
            )}
          </div>
          <TransfersPageSizeSelect
            value={limit}
            options={TRANSFER_PAGE_SIZES.map((size) => ({
              size,
              href: transfersPageHref(contractId, withPageSize(pageState, size))
            }))}
          />
        </nav>
      </div>
    </div>
  );
}
