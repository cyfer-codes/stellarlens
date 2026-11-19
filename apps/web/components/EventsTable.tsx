"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { EventRow, EventsPage } from "@/lib/api";
import { downloadCsv, eventsToCsv } from "@/lib/csvExport";
import { useVisibilityPolling } from "@/lib/useVisibilityPolling";
import { EmptyState } from "@/components/ui/EmptyState";
import { EventsTableSkeleton } from "./EventsTableSkeleton";

const POLL_INTERVAL_MS = 10000;
// The api caps `limit` at 100, so exports walk the cursor in pages of this size.
const EXPORT_PAGE_SIZE = 100;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const CURSOR_PARAM = "eventsCursor";
const PAGE_SIZE_PARAM = "eventsPageSize";

function parsePageSize(value: string | null): number {
  const size = Number(value);
  return PAGE_SIZE_OPTIONS.includes(size) ? size : 20;
}

function parseCursor(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const cursor = Number(value);
  return Number.isInteger(cursor) ? cursor : null;
}

function formatTopic(event: EventRow): string {
  const topic = event.decodedData?.decoded?.topic;
  if (!Array.isArray(topic) || topic.length === 0) {
    return "—";
  }
  return topic.map((entry) => JSON.stringify(entry)).join(", ");
}

type EventFilters = { topics: string[]; from: string; to: string };

function updateQuery(filters: EventFilters, pathname: string, router: ReturnType<typeof useRouter>) {
  const query = new URLSearchParams();
  if (filters.topics.length > 0) query.set("topics", filters.topics.join(","));
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  router.replace(`${pathname}${query.toString() ? `?${query}` : ""}`, { scroll: false });
}

function formatValue(event: EventRow): string {
  const value = event.decodedData?.decoded?.value;
  if (value === undefined) {
    return "—";
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function rawEventData(event: EventRow) {
  if (event.decodedData?.raw) return event.decodedData.raw;
  try {
    return { topic: JSON.parse(event.topic || "[]") };
  } catch {
    return { topic: event.topic };
  }
}

async function fetchAllEvents(contractId: number, filters: EventFilters, onProgress: (count: number) => void): Promise<EventRow[]> {
  const all: EventRow[] = [];
  let cursor: number | null = null;
  do {
    const query = new URLSearchParams({ limit: String(EXPORT_PAGE_SIZE) });
    if (cursor !== null) {
      query.set("cursor", String(cursor));
    }
    if (filters.topics.length > 0) query.set("topics", filters.topics.join(","));
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [pageSize, setPageSize] = useState(() => parsePageSize(searchParams.get(PAGE_SIZE_PARAM)));
  const [history, setHistory] = useState<CursorHistory>(() => ({
    cursors: [parseCursor(searchParams.get(CURSOR_PARAM))],
    index: 0
  }));
export function EventsTable({ contractId, network, contractAddress }: { contractId: number; network: string; contractAddress: string }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [filters, setFilters] = useState<EventFilters>({
    topics: searchParams.get("topics")?.split(",").filter(Boolean) ?? [],
    from: searchParams.get("from") ?? "",
    to: searchParams.get("to") ?? ""
  });
  const [topicDraft, setTopicDraft] = useState("");
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
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null);

  const activeCursor = history.cursors[history.index];

  const updateUrl = useCallback(
    (params: { cursor: number | null; pageSize: number }, mode: "push" | "replace") => {
      const next = new URLSearchParams(searchParams.toString());
      if (params.cursor === null) {
        next.delete(CURSOR_PARAM);
      } else {
        next.set(CURSOR_PARAM, String(params.cursor));
      }
      next.set(PAGE_SIZE_PARAM, String(params.pageSize));
      const query = next.toString();
      const url = query ? `${pathname}?${query}` : pathname;
      if (mode === "push") {
        router.push(url, { scroll: false });
      } else {
        router.replace(url, { scroll: false });
      }
    },
    [pathname, router, searchParams]
  );

  // Keep local state in sync when the URL changes from outside this component
  // (browser back/forward, or a shared link loaded fresh).
  useEffect(() => {
    const urlCursor = parseCursor(searchParams.get(CURSOR_PARAM));
    const urlPageSize = parsePageSize(searchParams.get(PAGE_SIZE_PARAM));

    setPageSize((current) => (current === urlPageSize ? current : urlPageSize));
    setHistory((current) => {
      if (current.cursors[current.index] === urlCursor) {
        return current;
      }
      return { cursors: [urlCursor], index: 0 };
    });
  }, [searchParams]);

  const fetchEvents = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({ limit: String(pageSize) });
      if (activeCursor !== null) {
        query.set("cursor", String(activeCursor));
      }
      if (filters.topics.length > 0) query.set("topics", filters.topics.join(","));
      if (filters.from) query.set("from", filters.from);
      if (filters.to) query.set("to", filters.to);
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
  }, [contractId, pageSize, activeCursor, filters]);

  useEffect(() => {
    fetchEvents();
    return () => {
      requestId.current++;
    };
  }, [fetchEvents]);

  useVisibilityPolling(fetchEvents, POLL_INTERVAL_MS);

  async function handleExport() {
    setExporting(true);
    setExportStatus("Preparing export…");
    try {
      const allEvents = await fetchAllEvents(contractId, filters, (count) => setExportStatus(`Fetched ${count} events…`));
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
      if (filters.topics.length > 0) query.set("topics", filters.topics.join(","));
      if (filters.from) query.set("from", filters.from);
      if (filters.to) query.set("to", filters.to);
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
    updateUrl({ cursor: nextCursor, pageSize }, "push");
    void loadPage(nextCursor);
  }

  function handlePreviousPage() {
    if (history.index === 0) {
      return;
    }
    const prevIndex = history.index - 1;
    const prevCursor = history.cursors[prevIndex];
    setHistory({ ...history, index: prevIndex });
    updateUrl({ cursor: prevCursor, pageSize }, "push");
    void loadPage(prevCursor);
  }

  function handlePageSizeChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const size = Number(event.target.value);
    setPageSize(size);
    setHistory({ cursors: [null], index: 0 });
    updateUrl({ cursor: null, pageSize: size }, "replace");
    void loadPage(null);
  }

  function applyFilters(next: EventFilters) {
    setFilters(next);
    setHistory({ cursors: [null], index: 0 });
    updateQuery(next, pathname, router);
  }

  function addTopic() {
    const topic = topicDraft.trim();
    if (topic && !filters.topics.includes(topic)) applyFilters({ ...filters, topics: [...filters.topics, topic] });
    setTopicDraft("");
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedEvent(null);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

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
      <div className="mb-4 space-y-3 rounded border border-gray-200 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-600">Topic<input value={topicDraft} onChange={(event) => setTopicDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && (event.preventDefault(), addTopic())} className="mt-1 block rounded border border-gray-300 px-2 py-1 text-sm" /></label>
          <button type="button" onClick={addTopic} className="rounded border border-gray-300 px-2 py-1 text-xs">Add topic</button>
          <label className="text-xs text-gray-600">From<input type="date" value={filters.from} onChange={(event) => applyFilters({ ...filters, from: event.target.value })} className="mt-1 block rounded border border-gray-300 px-2 py-1 text-sm" /></label>
          <label className="text-xs text-gray-600">To<input type="date" value={filters.to} onChange={(event) => applyFilters({ ...filters, to: event.target.value })} className="mt-1 block rounded border border-gray-300 px-2 py-1 text-sm" /></label>
          {filters.topics.map((topic) => <button key={topic} type="button" title={`Remove topic ${topic}`} onClick={() => applyFilters({ ...filters, topics: filters.topics.filter((value) => value !== topic) })} className="rounded-full border border-gray-300 px-2 py-1 text-xs">{topic} ×</button>)}
        </div>
      </div>
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
              <tr key={event.id} tabIndex={0} role="button" onClick={() => setSelectedEvent(event)} onKeyDown={(keyboardEvent) => (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") && (keyboardEvent.preventDefault(), setSelectedEvent(event))} className="cursor-pointer border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2">{event.ledger}</td>
                <td className="py-2 font-mono text-xs">{event.txHash.slice(0, 12)}…</td>
                <td className="py-2 font-mono text-xs">{formatTopic(event)}</td>
                <td className="py-2 font-mono text-xs">{formatValue(event)} {event.decodedData?.decodeErrors?.length ? <span title={event.decodedData.decodeErrors.map((item) => `${item.field}: ${item.error}`).join("; ")} className="ml-1 rounded bg-amber-100 px-1 text-amber-800">Warning</span> : null}</td>
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
      {selectedEvent && <EventDetailDrawer event={selectedEvent} network={network} contractAddress={contractAddress} onClose={() => setSelectedEvent(null)} />}
    </div>
  );
}

function EventDetailDrawer({ event, network, contractAddress, onClose }: { event: EventRow; network: string; contractAddress: string; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeButton.current?.focus(); }, []);
  const explorerNetwork = network === "mainnet" ? "public" : network;
  const decoded = event.decodedData?.decoded ?? null;
  const raw = rawEventData(event);
  function trapFocus(keyboardEvent: React.KeyboardEvent<HTMLElement>) {
    if (keyboardEvent.key === "Tab") {
      keyboardEvent.preventDefault();
      closeButton.current?.focus();
    }
  }
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside role="dialog" aria-modal="true" aria-labelledby="event-detail-title" onKeyDown={trapFocus} className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-xl"><div className="flex items-center justify-between"><h2 id="event-detail-title" className="text-lg font-semibold">Event details</h2><button ref={closeButton} type="button" onClick={onClose} aria-label="Close event details" className="rounded border border-gray-300 px-2 py-1">×</button></div><dl className="mt-4 space-y-2 text-sm"><div><dt className="font-medium">Ledger</dt><dd>{event.ledger}</dd></div><div><dt className="font-medium">Transaction</dt><dd className="break-all font-mono text-xs">{event.txHash}</dd></div></dl><a className="mt-3 inline-block text-sm text-blue-700 underline" target="_blank" rel="noreferrer" href={`https://stellar.expert/explorer/${explorerNetwork}/contract/${contractAddress}`}>Open contract in explorer</a><section className="mt-5"><h3 className="font-medium">Decoded JSON</h3><pre className="mt-2 overflow-auto rounded bg-gray-100 p-3 text-xs">{JSON.stringify(decoded, null, 2)}</pre></section><section className="mt-5"><h3 className="font-medium">Raw XDR</h3><button type="button" onClick={() => navigator.clipboard.writeText(JSON.stringify(raw, null, 2))} className="mt-2 rounded border border-gray-300 px-2 py-1 text-xs">Copy raw XDR</button><pre className="mt-2 overflow-auto rounded bg-gray-100 p-3 text-xs">{JSON.stringify(raw, null, 2)}</pre></section></aside></div>;
}
