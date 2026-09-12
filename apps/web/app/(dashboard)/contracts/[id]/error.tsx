"use client";

import { ErrorState } from "@/components/ui/ErrorState";

export default function ContractDetailError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Contract</h1>
      <ErrorState message={`Couldn't load this contract: ${error.message}`} onRetry={reset} />
    </div>
  );
}
