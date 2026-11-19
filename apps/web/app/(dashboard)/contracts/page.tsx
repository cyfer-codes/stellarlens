import { AddContractForm } from "@/components/AddContractForm";
import { ContractsTable } from "@/components/ContractsTable";
import { ContractsOnboarding } from "@/components/ContractsOnboarding";
import { EmptyState } from "@/components/ui/EmptyState";
import { listContracts } from "@/lib/api";
import { getSession } from "@/lib/session-server";

export default async function ContractsPage() {
  const [contracts, session] = await Promise.all([listContracts(), getSession()]);
  const authenticated = Boolean(session);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold">Contracts</h1>
        <p className="mt-1 text-sm text-gray-500">Registered Soroban contracts being indexed.</p>
      </div>

      {contracts.length === 0 ? (
        authenticated ? (
          <ContractsOnboarding />
        ) : (
          <EmptyState title="No contracts registered yet" />
        )
      ) : (
        <>
          <ContractsTable contracts={contracts} />

          {authenticated && (
            <div>
              <h2 className="mb-3 text-lg font-semibold">Add contract</h2>
              <AddContractForm />
            </div>
          )}
        </>
      )}
    </div>
  );
}
