import { ApiKeysManager } from "@/components/ApiKeysManager";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { UsersManager } from "@/components/UsersManager";
import { getCurrentUser } from "@/lib/auth";

export default async function SettingsPage() {
  const currentUser = await getCurrentUser();

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage the api keys used to authenticate against the stellarlens api.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">API keys</h2>
        <ApiKeysManager />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Your password</h2>
        <ChangePasswordForm />
      </section>

      {currentUser?.role === "admin" && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Users</h2>
          <UsersManager />
        </section>
      )}
    </div>
  );
}
