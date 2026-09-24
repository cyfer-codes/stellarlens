import Link from "next/link";
import { AddContractForm } from "@/components/AddContractForm";
import { ContractsOnboarding } from "@/components/ContractsOnboarding";
import { EmptyState } from "@/components/ui/EmptyState";
import { listContracts } from "@/lib/api";
import { getSession } from "@/lib/session";

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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="py-2 font-medium">Address</th>
                  <th className="py-2 font-medium">Name</th>
                  <th className="py-2 font-medium">Network</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((contract) => (
                  <tr key={contract.id} className="border-b border-gray-100">
                    <td className="py-2 font-mono text-xs">
                      <Link href={`/contracts/${contract.id}`} className="hover:underline">
                        {contract.address}
                      </Link>
                    </td>
                    <td className="py-2">{contract.name ?? "—"}</td>
                    <td className="py-2">{contract.network}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
