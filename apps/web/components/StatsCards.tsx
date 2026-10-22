"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ContractStats } from "@/lib/api";
import { useVisibilityPolling } from "@/lib/useVisibilityPolling";
import { Skeleton } from "@/components/ui/Skeleton";

const POLL_INTERVAL_MS = 15000;
const SKELETON_VOLUME_ROWS = 3;
const CARD_LABELS = ["Transfers", "Unique senders", "Unique receivers"] as const;

export function StatsCards({
  stats,
  contractId,
  loading = false
}: {
  stats?: ContractStats;
  contractId?: number;
  loading?: boolean;
}) {
  const [liveStats, setLiveStats] = useState(stats);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    setLiveStats(stats);
  }, [stats]);

  const refresh = useCallback(async () => {
    if (contractId === undefined || inFlight.current) {
      return;
    }
    inFlight.current = true;
    setRefreshing(true);
    try {
      const response = await fetch(`/api/contracts/${contractId}/stats`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`request failed with ${response.status}`);
      }
      setLiveStats((await response.json()) as ContractStats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to refresh stats");
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, [contractId]);

  useVisibilityPolling(refresh, POLL_INTERVAL_MS, { enabled: contractId !== undefined });

  const data = liveStats ?? stats;
  const isLoading = loading && data === undefined;

  const values = data && !isLoading ? [
    data.transferCount.toLocaleString(),
    data.uniqueSenders.toLocaleString(),
    data.uniqueReceivers.toLocaleString()
  ] : null;

  return (
    <div className="space-y-4" aria-busy={isLoading}>
      {isLoading && <span className="sr-only">Loading contract stats…</span>}
      {contractId !== undefined && (
        <div className="flex items-center justify-end gap-3">
          {error && (
            <p role="status" className="text-sm text-red-600">
              Couldn&apos;t refresh stats: {error}
            </p>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            aria-label="Refresh contract stats"
            className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {CARD_LABELS.map((label, index) => (
          <div key={label} className="rounded border border-gray-200 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
            {values ? (
              <div className="mt-1 text-2xl font-bold">{values[index]}</div>
            ) : (
              <Skeleton className="mb-1 mt-2 h-6 w-24" />
            )}
          </div>
        ))}
      </div>
      <div className="rounded border border-gray-200 p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Volume by asset</div>
        {isLoading || data === undefined ? (
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
