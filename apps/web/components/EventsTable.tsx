"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EventRow, EventsPage } from "@/lib/api";
import { downloadCsv, eventsToCsv } from "@/lib/csvExport";
import { useVisibilityPolling } from "@/lib/useVisibilityPolling";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { EventsTableSkeleton } from "./EventsTableSkeleton";

const POLL_INTERVAL_MS = 10000;
// The api caps `limit` at 100, so exports walk the cursor in pages of this size.
const EXPORT_PAGE_SIZE = 100;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

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

async function fetchAllEvents(contractId: number, onProgress: (count: number) => void): Promise<EventRow[]> {
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

type CursorHistory = {
  cursors: (number | null)[];
  index: number;
};

export function EventsTable({ contractId }: { contractId: number }) {
  const [pageSize, setPageSize] = useState(20);
  const [history, setHistory] = useState<CursorHistory>({ cursors: [null], index: 0 });
  const [events, setEvents] = useState<EventRow[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const requestId = useRef(0);

  const activeCursor = history.cursors[history.index];

  const fetchEvents = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({ limit: String(pageSize) });
      if (activeCursor !== null) {
        query.set("cursor", String(activeCursor));
      }
      const response = await fetch(`/api/contracts/${contractId}/events?${query}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`request failed with ${response.status}`);
      }
      const body = (await response.json()) as EventsPage;
      if (id === requestId.current) {
        setEvents(body.data);
        setNextCursor(body.nextCursor ?? null);
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
  }, [contractId, pageSize, activeCursor]);

  useEffect(() => {
    fetchEvents();
    return () => {
      requestId.current++;
    };
  }, [fetchEvents]);

  useVisibilityPolling(fetchEvents, POLL_INTERVAL_MS);

  function retry() {
    fetchEvents();
  }

  async function handleExport() {
    setExporting(true);
    setExportStatus("Preparing export…");
    try {
      const allEvents = await fetchAllEvents(contractId, (count) => setExportStatus(`Fetched ${count} events…`));
      const date = new Date().toISOString().slice(0, 10);
      downloadCsv(`contract-${contractId}-events-${date}.csv`, eventsToCsv(allEvents));
      setExportStatus(`Exported ${allEvents.length} events.`);
    } catch (err) {
      setExportStatus(`Export failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setExporting(false);
    }
  }

  async function loadPage(cursor: number | null) {
    setPageLoading(true);
    setPageError(null);
    try {
      const query = new URLSearchParams({ limit: String(pageSize) });
      if (cursor !== null) {
        query.set("cursor", String(cursor));
      }
      const response = await fetch(`/api/contracts/${contractId}/events?${query}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`request failed with ${response.status}`);
      }
      const body = (await response.json()) as EventsPage;
      setEvents(body.data);
      setNextCursor(body.nextCursor ?? null);
      setError(null);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "failed to load events");
    } finally {
      setPageLoading(false);
    }
  }

  function handleNextPage() {
    if (nextCursor === null) {
      return;
    }
    const nextIndex = history.index + 1;
    const cursors = history.cursors.slice(0, nextIndex);
    cursors[nextIndex] = nextCursor;
    setHistory({ cursors, index: nextIndex });
    void loadPage(nextCursor);
  }

  function handlePreviousPage() {
    if (history.index === 0) {
      return;
    }
    const prevIndex = history.index - 1;
    setHistory({ ...history, index: prevIndex });
    void loadPage(history.cursors[prevIndex]);
  }

  function handlePageSizeChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const size = Number(event.target.value);
    setPageSize(size);
    setHistory({ cursors: [null], index: 0 });
    void loadPage(null);
  }

  if (loading && events.length === 0) {
    return <EventsTableSkeleton />;
  }

  if (events.length === 0 && !loading) {
    return (
      <div>
        {error && <p className="mb-2 text-sm text-red-600">Couldn&apos;t refresh events: {error}</p>}
        <EmptyState
          title="No events found"
          description="Events will appear here automatically as the indexer picks up activity for this contract."
        />
      </div>
    );
  }

  return (
    <div>
      {error && <p className="mb-2 text-sm text-red-600">Couldn&apos;t refresh events: {error}</p>}
      <div className="mb-2 flex items-center justify-end gap-3">
        <span role="status" aria-live="polite" className="text-xs text-gray-500">
          {exportStatus}
        </span>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          aria-label="Export CSV of the full event history for this contract"
          className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>
      {pageError && <p className="mb-2 text-sm text-red-600">Couldn&apos;t load page: {pageError}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <caption className="sr-only">Contract events with ledger, transaction hash, topic and decoded data</caption>
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th scope="col" className="py-2 font-medium">Ledger</th>
              <th scope="col" className="py-2 font-medium">Tx hash</th>
              <th scope="col" className="py-2 font-medium">Topic</th>
              <th scope="col" className="py-2 font-medium">Decoded data</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-b border-gray-100">
                <td className="py-2">{event.ledger}</td>
                <td className="py-2 font-mono text-xs">{event.txHash.slice(0, 12)}…</td>
                <td className="py-2 font-mono text-xs">{formatTopic(event)}</td>
                <td className="py-2 font-mono text-xs">{formatValue(event)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={handlePageSizeChange}
            disabled={pageLoading || loading}
            aria-label="Rows per page"
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-50"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePreviousPage}
            disabled={pageLoading || history.index === 0}
            aria-label="Previous page of events"
            className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={handleNextPage}
            disabled={pageLoading || nextCursor === null}
            aria-label="Next page of events"
            className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
