"use client";

import { ErrorState } from "@/components/ui/ErrorState";

export default function ContractDetailError({ error: _error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Contract</h1>
      <ErrorState
        title="Unable to load contract"
        message="An error occurred while loading this contract. Please try again or check back later."
        onRetry={reset}
      />
    </div>
  );
}
