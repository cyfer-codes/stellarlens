"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ContractStats } from "@/lib/api";
import { useVisibilityPolling } from "@/lib/useVisibilityPolling";

const POLL_INTERVAL_MS = 15000;

/**
 * Renders the contract stats cards. When `contractId` is given, the cards
 * poll for fresh stats while the tab is visible and show a manual refresh
 * button that works alongside the background polling.
 */
export function StatsCards({ stats, contractId }: { stats: ContractStats; contractId?: number }) {
  const [liveStats, setLiveStats] = useState(stats);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    setLiveStats(stats);
  }, [stats]);

  const refresh = useCallback(async () => {
    // Skip overlapping requests, e.g. a manual refresh landing mid-poll.
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

  const cards = [
    { label: "Transfers", value: liveStats.transferCount.toLocaleString() },
    { label: "Unique senders", value: liveStats.uniqueSenders.toLocaleString() },
    { label: "Unique receivers", value: liveStats.uniqueReceivers.toLocaleString() }
  ];

  return (
    <div className="space-y-4">
      {contractId !== undefined && (
        <div className="flex items-center justify-end gap-3">
          {error && (
            <p role="status" className="text-sm text-red-600 dark:text-red-400">
              Couldn&apos;t refresh stats: {error}
            </p>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            aria-label="Refresh contract stats"
            className="rounded border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{card.label}</div>
            <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Volume by asset</div>
        {liveStats.volumeByAsset.length === 0 ? (
          <p className="mt-2 text-sm text-gray-400 dark:text-gray-500">No transfer volume yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {liveStats.volumeByAsset.map((entry) => (
              <li key={entry.asset} className="flex justify-between font-mono text-xs text-gray-800 dark:text-gray-200">
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
