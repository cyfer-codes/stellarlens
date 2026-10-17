import type { ContractStats } from "@/lib/api";
import { Skeleton } from "@/components/ui/Skeleton";

const CARD_LABELS = ["Transfers", "Unique senders", "Unique receivers"] as const;
const SKELETON_VOLUME_ROWS = 3;

/**
 * Renders the stats cards, or skeleton placeholders inside the same card
 * containers while `loading` is set or `stats` hasn't arrived yet, so the
 * layout doesn't shift when the real numbers land.
 */
export function StatsCards({ stats, loading = false }: { stats?: ContractStats; loading?: boolean }) {
  const data = loading ? undefined : stats;
  const values = data
    ? [
        data.transferCount.toLocaleString(),
        data.uniqueSenders.toLocaleString(),
        data.uniqueReceivers.toLocaleString()
      ]
    : null;

  return (
    <div className="space-y-4" aria-busy={!data}>
      {!data && <span className="sr-only">Loading contract stats…</span>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {CARD_LABELS.map((label, index) => (
          <div key={label} className="rounded border border-gray-200 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
            {values ? (
              <div className="mt-1 text-2xl font-bold">{values[index]}</div>
            ) : (
              // mt-2 + h-6 + mb-1 matches mt-1 plus the 2rem line height of the text-2xl value.
              <Skeleton className="mb-1 mt-2 h-6 w-24" />
            )}
          </div>
        ))}
      </div>

      <div className="rounded border border-gray-200 p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Volume by asset</div>
        {!data ? (
          <ul className="mt-2 space-y-1">
            {Array.from({ length: SKELETON_VOLUME_ROWS }, (_, index) => (
              <li key={index} className="flex h-4 items-center justify-between">
                <Skeleton className="h-3 w-48" />
                <Skeleton className="h-3 w-16" />
              </li>
            ))}
          </ul>
        ) : data.volumeByAsset.length === 0 ? (
          <p className="mt-2 text-sm text-gray-400">No transfer volume yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {data.volumeByAsset.map((entry) => (
              <li key={entry.asset} className="flex justify-between font-mono text-xs">
                <span className="truncate pr-4">{entry.asset}</span>
                <span>{entry.volume}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
