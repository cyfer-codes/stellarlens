"use client";

import { type FormEvent, useEffect, useState } from "react";
import type { ApiKeyRow } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";

export function ApiKeysManager() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
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
      const response = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || undefined })
      });
      if (!response.ok) {
        throw new Error(`request failed with ${response.status}`);
      }
      const created = (await response.json()) as { key: string };
      setJustGenerated(created.key);
      setName("");
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
      {error && <p className="text-sm text-red-600">{error}</p>}

      {justGenerated && (
        <div className="rounded border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            New api key generated — copy it now, it won&apos;t be shown again:
          </p>
          <code className="mt-2 block break-all rounded bg-white px-3 py-2 text-xs">{justGenerated}</code>
        </div>
      )}

      <form onSubmit={handleGenerate} className="flex max-w-sm items-end gap-2">
        <div className="flex-1">
          <label htmlFor="key-name" className="block text-sm font-medium text-gray-700">
            Name <span className="text-gray-400">(optional)</span>
          </label>
          <input
            id="key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={generating}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
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
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Created</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id} className="border-b border-gray-100">
                <td className="py-2">{key.name ?? "—"}</td>
                <td className="py-2">{new Date(key.createdAt).toLocaleString()}</td>
                <td className="py-2">
                  {key.revokedAt ? (
                    <span className="text-gray-400">Revoked</span>
                  ) : (
                    <span className="text-green-700">Active</span>
                  )}
                </td>
                <td className="py-2 text-right">
                  {!key.revokedAt && (
                    <button
                      type="button"
                      onClick={() => handleRevoke(key.id)}
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
