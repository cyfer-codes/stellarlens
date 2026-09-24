import Link from "next/link";
import { Sidebar } from "../../components/Sidebar";
import { getSession } from "@/lib/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const isDemoVisitor = !session && process.env.PUBLIC_DEMO === "true";

  return (
    <div className="flex min-h-screen w-full flex-col md:flex-row">
      <Sidebar authenticated={Boolean(session)} />
      <main className="flex-1 p-4 md:p-8">
        {isDemoVisitor && (
          <div className="mb-6 rounded border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-700">
            You&apos;re viewing a live read-only demo.{" "}
            <Link href="/login" className="font-medium underline">
              Sign in
            </Link>{" "}
            to register and manage your own contracts.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
