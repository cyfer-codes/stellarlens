"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EventRow, EventsPage } from "@/lib/api";
import { downloadCsv, eventsToCsv } from "@/lib/csvExport";
import { useVisibilityPolling } from "@/lib/useVisibilityPolling";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";

const POLL_INTERVAL_MS = 10000;
const PAGE_SIZE = 20;
// The api caps `limit` at 100, so exports walk the cursor in pages of this size.
const EXPORT_PAGE_SIZE = 100;

function formatTopic(event: EventRow): string {
  const topic = event.decodedData?.decoded?.topic;
  if (!Array.isArray(topic) || topic.length === 0) {
    return "—";
  }
  return topic.map((entry) => JSON.stringify(entry)).join(", ");
}

function formatValue(event: EventRow): string {
  const value = event.decodedData?.decoded?.value;
  if (value === undefined) {
    return "—";
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function fetchAllEvents(
  contractId: number,
  onProgress: (count: number) => void
): Promise<EventRow[]> {
  const all: EventRow[] = [];
  let cursor: number | null = null;
  do {
    const query = new URLSearchParams({ limit: String(EXPORT_PAGE_SIZE) });
    if (cursor !== null) {
      query.set("cursor", String(cursor));
    }
    const response = await fetch(`/api/contracts/${contractId}/events?${query}`, {
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`request failed with ${response.status}`);
    }
    const page = (await response.json()) as EventsPage;
    all.push(...page.data);
    onProgress(all.length);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return all;
}

export function EventsTable({ contractId }: { contractId: number }) {
  // Cursors of the pages visited so far; the last entry is the active page and
  // `undefined` is the newest page. Polling re-fetches the active cursor, so
  // new events only shift rows on the first page while older pages stay put.
  const [cursors, setCursors] = useState<(number | undefined)[]>([undefined]);
  const [page, setPage] = useState<EventsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const requestId = useRef(0);

  const cursor = cursors[cursors.length - 1];

  const fetchEvents = useCallback(async () => {
    const id = ++requestId.current;
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor !== undefined) {
      query.set("cursor", String(cursor));
    }

    try {
      const response = await fetch(`/api/contracts/${contractId}/events?${query}`, {
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error(`request failed with ${response.status}`);
      }
      const body = (await response.json()) as EventsPage;
      // Drop responses superseded by a newer request (e.g. after a page change).
      if (id === requestId.current) {
        setPage(body);
        setError(null);
      }
    } catch (err) {
      if (id === requestId.current) {
        setError(err instanceof Error ? err.message : "failed to load events");
      }
    } finally {
      if (id === requestId.current) {
        setLoading(false);
      }
    }
  }, [contractId, cursor]);

  useEffect(() => {
    setLoading(true);
    fetchEvents();
    return () => {
      // Invalidate any in-flight request when the cursor or contract changes.
      requestId.current++;
    };
  }, [fetchEvents]);

  useVisibilityPolling(fetchEvents, POLL_INTERVAL_MS);

  function retry() {
    setLoading(true);
    fetchEvents();
  }

  async function handleExport() {
    setExporting(true);
    setExportStatus("Preparing export…");
    try {
      const allEvents = await fetchAllEvents(contractId, (count) =>
        setExportStatus(`Fetched ${count} events…`)
      );
      const date = new Date().toISOString().slice(0, 10);
      downloadCsv(`contract-${contractId}-events-${date}.csv`, eventsToCsv(allEvents));
      setExportStatus(`Exported ${allEvents.length} events.`);
    } catch (err) {
      setExportStatus(`Export failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return <LoadingState label="Loading events…" />;
  }

  if (!page) {
    return (
      <ErrorState
        title="Couldn't load events"
        message={error ?? "failed to load events"}
        onRetry={retry}
      />
    );
  }

  const isFirstPage = cursors.length === 1;
  const { data: events, nextCursor } = page;

  if (isFirstPage && events.length === 0) {
    return (
      <div>
        {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">Couldn&apos;t refresh events: {error}</p>}
        <EmptyState
          title="No events found"
          description="Events will appear here automatically as the indexer picks up activity for this contract."
        />
      </div>
    );
  }

  return (
    <div>
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">Couldn&apos;t refresh events: {error}</p>}
      <div className="mb-2 flex items-center justify-end gap-3">
        <span role="status" aria-live="polite" className="text-xs text-gray-500 dark:text-gray-400">
          {exportStatus}
        </span>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          aria-label="Export CSV of the full event history for this contract"
          className="rounded border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>
      {events.length === 0 ? (
        <EmptyState
          title="No older events"
          description="You've reached the oldest indexed events for this contract."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <caption className="sr-only">
              Contract events with ledger, transaction hash, topic and decoded data
            </caption>
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400">
                <th scope="col" className="py-2 font-medium">
                  Ledger
                </th>
                <th scope="col" className="py-2 font-medium">
                  Tx hash
                </th>
                <th scope="col" className="py-2 font-medium">
                  Topic
                </th>
                <th scope="col" className="py-2 font-medium">
                  Decoded data
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-2 text-gray-800 dark:text-gray-200">{event.ledger}</td>
                  <td className="py-2 font-mono text-xs text-gray-700 dark:text-gray-300">{event.txHash.slice(0, 12)}…</td>
                  <td className="py-2 font-mono text-xs text-gray-700 dark:text-gray-300">{formatTopic(event)}</td>
                  <td className="py-2 font-mono text-xs text-gray-700 dark:text-gray-300">{formatValue(event)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(!isFirstPage || nextCursor !== null) && (
        <div className="mt-4 flex gap-2">
          {!isFirstPage && (
            <button
              type="button"
              onClick={() => setCursors((previous) => previous.slice(0, -1))}
              className="rounded border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <span aria-hidden="true">?</span> Newer
            </button>
          )}
          {nextCursor !== null && (
            <button
              type="button"
              onClick={() => setCursors((previous) => [...previous, nextCursor])}
              className="rounded bg-gray-900 dark:bg-gray-800 px-4 py-2 text-sm font-medium text-white dark:text-gray-100 hover:bg-gray-800 dark:hover:bg-gray-700"
            >
              Older <span aria-hidden="true">?</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
