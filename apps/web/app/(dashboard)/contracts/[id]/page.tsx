import Link from "next/link";
import { notFound } from "next/navigation";
import { EventsTable } from "@/components/EventsTable";
import { StatsCards } from "@/components/StatsCards";
import { WebhooksManager } from "@/components/WebhooksManager";
import { ApiNotFoundError, getContract, getContractStats } from "@/lib/api";
import { getSession } from "@/lib/session";

export default async function ContractDetailPage({ params }: { params: { id: string } }) {
  const contractId = Number(params.id);
  if (!Number.isInteger(contractId)) {
    notFound();
  }

  let contract;
  let stats;
  let session;
  try {
    [contract, stats, session] = await Promise.all([
      getContract(contractId),
      getContractStats(contractId),
      getSession()
    ]);
  } catch (err) {
    if (err instanceof ApiNotFoundError) {
      notFound();
    }
    throw err;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{contract.name ?? contract.address}</h1>
        <p className="mt-1 font-mono text-xs text-gray-500">{contract.address}</p>
        <p className="text-sm text-gray-500">{contract.network}</p>
      </div>

      <StatsCards stats={stats} />

      <Link
        href={`/contracts/${contractId}/transfers`}
        className="inline-block text-sm font-medium text-gray-700 hover:underline"
      >
        View transfers →
      </Link>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Events</h2>
        <EventsTable contractId={contractId} />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Webhooks</h2>
        <WebhooksManager contractId={contractId} authenticated={Boolean(session)} />
      </div>
    </div>
  );
}
