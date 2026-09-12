import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";

export default function EventsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Events</h1>
      <EmptyState
        title="Select a contract to view its events"
        description="Events are scoped to a single contract. Open a contract from the Contracts page to see its live event feed."
        action={
          <Link href="/contracts" className="text-sm font-medium text-gray-900 hover:underline">
            Go to Contracts →
          </Link>
        }
      />
    </div>
  );
}
