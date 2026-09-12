import { AddContractForm } from "@/components/AddContractForm";

export function ContractsOnboarding() {
  return (
    <div className="mx-auto max-w-sm space-y-6 rounded border border-dashed border-gray-300 px-8 py-10 text-center">
      <div>
        <h2 className="text-lg font-semibold">Register your first contract</h2>
        <p className="mt-1 text-sm text-gray-500">
          stellarlens indexes Soroban contract events and token transfers. Add a contract address below to
          start indexing — the indexer picks up activity for any contract registered here automatically.
        </p>
      </div>
      <div className="text-left">
        <AddContractForm />
      </div>
    </div>
  );
}
