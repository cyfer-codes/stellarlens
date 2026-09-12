"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TransferRow } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";

function toDayBuckets(transfers: TransferRow[]): { date: string; volume: number }[] {
  const buckets = new Map<string, number>();
  for (const transfer of transfers) {
    const date = transfer.createdAt.slice(0, 10);
    buckets.set(date, (buckets.get(date) ?? 0) + Number(transfer.amount));
  }
  return Array.from(buckets.entries())
    .map(([date, volume]) => ({ date, volume }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function VolumeChart({ transfers }: { transfers: TransferRow[] }) {
  const data = toDayBuckets(transfers);

  if (data.length === 0) {
    return (
      <EmptyState
        title="No transfer volume yet"
        description="Volume will appear here once transfers are indexed for this contract."
      />
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Bar dataKey="volume" fill="#111827" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
