"use client";

import { type FormEvent, useEffect, useState } from "react";
import type { ApiKeyRow, ApiKeyScope } from "@/lib/apiKeys";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { CopyButton } from "@/components/ui/CopyButton";

export function ApiKeysManager() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<ApiKeyScope>("full");
  const [expiresAt, setExpiresAt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [justGenerated, setJustGenerated] = useState<string | null>(null);

  async function refresh() {
    try {
      const response = await fetch("/api/api-keys", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`request failed with ${response.status}`);
      }
      setKeys((await response.json()) as ApiKeyRow[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load api keys");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGenerating(true);
    try {
      const payload: { name?: string; scope: ApiKeyScope; expiresAt?: string } = {
        scope
      };
      if (name.trim()) payload.name = name.trim();
      if (expiresAt) {
        payload.expiresAt = new Date(expiresAt).toISOString();
      }

      const response = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`request failed with ${response.status}`);
      }
      const created = (await response.json()) as { key: string };
      setJustGenerated(created.key);
      setName("");
      setScope("full");
      setExpiresAt("");
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to generate api key");
    } finally {
      setGenerating(false);
    }
  }

  async function handleRevoke(id: number) {
    try {
      const response = await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`request failed with ${response.status}`);
      }
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to revoke api key");
    }
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {justGenerated && (
        <div className="rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            New api key generated — copy it now, it won&apos;t be shown again:
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-white dark:bg-gray-900 px-3 py-2 text-xs">{justGenerated}</code>
            <CopyButton value={justGenerated} ariaLabel="Copy api key" />
            <button
              type="button"
              onClick={() => setJustGenerated(null)}
              className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleGenerate} className="flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 min-w-[140px]">
          <label htmlFor="key-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Name <span className="text-gray-400 dark:text-gray-500">(optional)</span>
          </label>
          <input
            id="key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-900"
          />
        </div>
        <div className="w-full sm:w-36">
          <label htmlFor="key-scope" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Scope
          </label>
          <select
            id="key-scope"
            value={scope}
            onChange={(event) => setScope(event.target.value as ApiKeyScope)}
            className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-900"
          >
            <option value="full">Full access</option>
            <option value="read">Read-only</option>
          </select>
        </div>
        <div className="w-full sm:w-44">
          <label htmlFor="key-expires-at" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Expiry <span className="text-gray-400 dark:text-gray-500">(optional)</span>
          </label>
          <input
            id="key-expires-at"
            type="date"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-900"
          />
        </div>
        <button
          type="submit"
          disabled={generating}
          className="rounded bg-gray-900 dark:bg-gray-100 px-4 py-2 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50 sm:shrink-0"
        >
          {generating ? "Generating…" : "Generate key"}
        </button>
      </form>

      {loading ? (
        <LoadingState label="Loading api keys…" />
      ) : keys.length === 0 ? (
        <EmptyState
          title="No api keys yet"
          description="Generate one above to authenticate dashboard requests against the stellarlens api."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] border-collapse text-left text-sm">
            <caption className="sr-only">API keys with name, scope, creation date, expiry and status</caption>
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                <th scope="col" className="py-2 font-medium">Name</th>
                <th scope="col" className="py-2 font-medium">Scope</th>
                <th scope="col" className="py-2 font-medium">Created</th>
                <th scope="col" className="py-2 font-medium">Expires</th>
                <th scope="col" className="py-2 font-medium">Status</th>
                <th scope="col" className="py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const isExpired = Boolean(key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now());
                const isRevoked = Boolean(key.revokedAt);

                return (
                  <tr key={key.id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 font-medium">{key.name ?? "—"}</td>
                    <td className="py-2">
                      <span className="capitalize">{key.scope === "read" ? "Read-only" : "Full access"}</span>
                    </td>
                    <td className="py-2">{new Date(key.createdAt).toLocaleString()}</td>
                    <td className="py-2">
                      {key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : "Never"}
                    </td>
                    <td className="py-2">
                      {isRevoked ? (
                        <span className="text-gray-400 dark:text-gray-500">Revoked</span>
                      ) : isExpired ? (
                        <span className="text-amber-700 dark:text-amber-400 font-medium">Expired</span>
                      ) : (
                        <span className="text-green-700 dark:text-green-400">Active</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {!isRevoked && (
                        <button
                          type="button"
                          onClick={() => handleRevoke(key.id)}
                          className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
