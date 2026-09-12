"use client";

import { useEffect, useState } from "react";
import type { EventRow } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";

const POLL_INTERVAL_MS = 10000;

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

export function EventsTable({ contractId }: { contractId: number }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchEvents() {
      try {
        const response = await fetch(`/api/contracts/${contractId}/events?limit=20`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`request failed with ${response.status}`);
        }
        const body = (await response.json()) as { data: EventRow[] };
        if (!cancelled) {
          setEvents(body.data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "failed to load events");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchEvents();
    const interval = setInterval(fetchEvents, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [contractId]);

  if (loading) {
    return <LoadingState label="Loading events…" />;
  }

  return (
    <div>
      {error && <p className="mb-2 text-sm text-red-600">Couldn&apos;t refresh events: {error}</p>}
      {events.length === 0 ? (
        <EmptyState
          title="No events yet"
          description="Events will appear here automatically as the indexer picks up activity for this contract."
        />
      ) : (
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th className="py-2 font-medium">Ledger</th>
              <th className="py-2 font-medium">Tx hash</th>
              <th className="py-2 font-medium">Topic</th>
              <th className="py-2 font-medium">Decoded data</th>
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
      )}
    </div>
  );
}
