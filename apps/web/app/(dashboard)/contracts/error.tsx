"use client";

import { ErrorState } from "@/components/ui/ErrorState";

export default function ContractsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Contracts</h1>
      <ErrorState message="Couldn't load contracts. Please try again." onRetry={reset} />
    </div>
  );
}
