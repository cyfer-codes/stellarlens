"use client";

import { ErrorState } from "@/components/ui/ErrorState";

export default function ContractTransfersError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Transfers</h1>
      <ErrorState message="Couldn't load transfers. Please try again." onRetry={reset} />
    </div>
  );
}
