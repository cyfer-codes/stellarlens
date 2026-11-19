"use client";

import { ErrorState } from "@/components/ui/ErrorState";

export default function DashboardError({ error: _error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <ErrorState
        title="Something went wrong"
        message="An unexpected error occurred while loading this dashboard view. Please try again."
        onRetry={reset}
      />
    </div>
  );
}
