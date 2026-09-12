import { LoadingState } from "@/components/ui/LoadingState";

export default function ContractDetailLoading() {
  return (
    <div className="space-y-8">
      <LoadingState label="Loading contract…" />
    </div>
  );
}
