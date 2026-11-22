"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { RecentEventRow } from "@/lib/api";
import { useVisibilityPolling } from "@/lib/useVisibilityPolling";
import { EmptyState } from "@/components/ui/EmptyState";

const POLL_INTERVAL_MS = 10000;

function formatTopic(event: RecentEventRow): string {
    const topic = event.decodedData?.decoded?.topic;
    if (Array.isArray(topic) && topic.length > 0) {
        return topic.map((entry) => JSON.stringify(entry)).join(", ");
    }
    try {
        const rawTopic = JSON.parse(event.topic) as unknown;
        return Array.isArray(rawTopic) && rawTopic.length > 0 ? rawTopic.join(", ") : "—";
    } catch {
        return "—";
    }
}

export function RecentEventsFeed({ initialEvents }: { initialEvents: RecentEventRow[] }) {
    const [events, setEvents] = useState(initialEvents);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const response = await fetch("/api/events?limit=20", { cache: "no-store" });
            if (!response.ok) {
                throw new Error(`request failed with ${response.status}`);
            }
            setEvents((await response.json()) as RecentEventRow[]);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "failed to refresh events");
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);
    useVisibilityPolling(refresh, POLL_INTERVAL_MS);

    if (events.length === 0) {
        return <EmptyState title="No events found" description="Recent events will appear here as registered contracts are indexed." />;
    }

    return (
        <div>
            {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">Couldn&apos;t refresh events: {error}</p>}
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <caption className="sr-only">Recent events across registered contracts</caption>
                <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                        <th scope="col" className="py-2 font-medium">Contract</th>
                        <th scope="col" className="py-2 font-medium">Topic</th>
                        <th scope="col" className="py-2 font-medium">Ledger</th>
                        <th scope="col" className="py-2 font-medium">Time</th>
                    </tr>
                </thead>
                <tbody>
                    {events.map((event) => (
                        <tr key={event.id} className="border-b border-gray-100 dark:border-gray-800">
                            <td className="py-2">
                                <Link href={`/contracts/${event.contractId}`} className="font-medium hover:underline">
                                    {event.contractName ?? `Contract ${event.contractId}`}
                                </Link>
                            </td>
                            <td className="max-w-[24rem] truncate py-2">{formatTopic(event)}</td>
                            <td className="py-2">{event.ledger}</td>
                            <td className="whitespace-nowrap py-2 text-gray-500 dark:text-gray-400">{new Date(event.createdAt).toLocaleString()}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}