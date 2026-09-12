import { LoadingState } from "@/components/ui/LoadingState";

export default function ContractsLoading() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold">Contracts</h1>
        <p className="mt-1 text-sm text-gray-500">Registered Soroban contracts being indexed.</p>
      </div>
      <LoadingState label="Loading contracts…" />
    </div>
  );
}
