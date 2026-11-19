"use client";

import { ErrorState } from "@/components/ui/ErrorState";

export default function ContractsError({ error: _error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Contracts</h1>
      <ErrorState
        title="Unable to load contracts"
        message="An error occurred while loading registered contracts. Please try again or check back later."
        onRetry={reset}
      />
    </div>
  );
}
