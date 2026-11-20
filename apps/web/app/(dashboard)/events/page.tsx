import { RecentEventsFeed } from "@/components/RecentEventsFeed";
import { listRecentEvents } from "@/lib/api";

export default async function EventsPage() {
    const events = await listRecentEvents();

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold">Events</h1>
            <RecentEventsFeed initialEvents={events} />
        </div>
    );
}
