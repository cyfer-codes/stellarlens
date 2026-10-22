import EventsTableSkeleton from "@/components/EventsTableSkeleton";
import { StatsCards } from "@/components/StatsCards";
import { Skeleton } from "@/components/ui/Skeleton";

export default function ContractDetailLoading() {
  return (
    <div className="space-y-6">
      <StatsCards loading />
      <div className="space-y-3">
        <Skeleton className="h-5 w-48" />
        <EventsTableSkeleton />
      </div>
    </div>
  );
}
