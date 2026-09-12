import { LoadingState } from "@/components/ui/LoadingState";

export default function ContractTransfersLoading() {
  return (
    <div className="space-y-8">
      <LoadingState label="Loading transfers…" />
    </div>
  );
}
