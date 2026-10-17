import { EventsTableSkeleton } from "@/components/EventsTable";
import { StatsCards } from "@/components/StatsCards";
import { Skeleton } from "@/components/ui/Skeleton";

export default function ContractDetailLoading() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-8 w-64" />

      <StatsCards loading />

      <div>
        <h2 className="mb-3 text-lg font-semibold">Events</h2>
        <EventsTableSkeleton />
      </div>
    </div>
  );
}
