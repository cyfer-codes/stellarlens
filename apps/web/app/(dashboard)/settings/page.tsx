import type { Metadata } from "next";
import { ApiKeysManager } from "@/components/ApiKeysManager";

export const metadata: Metadata = {
  title: "Settings"
};

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage the api keys used to authenticate against the stellarlens api.
        </p>
      </div>
      <ApiKeysManager />
    </div>
  );
}
