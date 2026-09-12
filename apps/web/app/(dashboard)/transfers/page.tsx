import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";

export default function TransfersPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Transfers</h1>
      <EmptyState
        title="Select a contract to view its transfers"
        description="Transfers are scoped to a single contract. Open a contract from the Contracts page to see its transfer history and volume chart."
        action={
          <Link href="/contracts" className="text-sm font-medium text-gray-900 hover:underline">
            Go to Contracts →
          </Link>
        }
      />
    </div>
  );
}
