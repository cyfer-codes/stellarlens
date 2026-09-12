"use client";

import { ErrorState } from "@/components/ui/ErrorState";

export default function ContractsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Contracts</h1>
      <ErrorState message={`Couldn't load contracts: ${error.message}`} onRetry={reset} />
    </div>
  );
}
