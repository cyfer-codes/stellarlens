"use client";

import { ErrorState } from "@/components/ui/ErrorState";

export default function ContractTransfersError({ error: _error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Transfers</h1>
      <ErrorState
        title="Unable to load transfers"
        message="An error occurred while loading transfers for this contract. Please try again or check back later."
        onRetry={reset}
      />
    </div>
  );
}
