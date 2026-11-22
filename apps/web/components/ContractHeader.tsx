"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { Contract, ContractStatus } from "@/lib/api";
import { useVisibilityPolling } from "@/lib/useVisibilityPolling";

export function ContractHeader({ contract, authenticated }: { contract: Contract; authenticated: boolean }) {
  const [name, setName] = useState<string | null>(contract.name);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(contract.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ContractStatus | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/contracts/${contract.id}/status`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`request failed with ${response.status}`);
      }
      setStatus((await response.json()) as ContractStatus);
    } catch {
      setStatus(null);
    }
  }, [contract.id]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);
  useVisibilityPolling(refreshStatus, 10000);

  function startEditing() {
    setNameInput(name ?? "");
    setError(null);
    setEditing(true);
  }

  function handleCancel() {
    setEditing(false);
    setNameInput(name ?? "");
    setError(null);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const trimmed = nameInput.trim();
      const response = await fetch(`/api/contracts/${contract.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed || null })
      });
      if (!response.ok) {
        throw new Error(`request failed with ${response.status}`);
      }
      const updated = (await response.json()) as Contract;
      setName(updated.name);
      setEditing(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to update contract name");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {editing ? (
        <form onSubmit={handleSave} className="max-w-sm space-y-2">
          <div>
            <label htmlFor="contract-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Name <span className="text-gray-400 dark:text-gray-500">(optional)</span>
            </label>
            <input
              id="contract-name"
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder="Contract name"
              autoFocus
              className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm"
            />
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-gray-900 dark:bg-gray-100 px-4 py-2 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="rounded border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold">{name ?? contract.address}</h1>
          {authenticated && (
            <button
              type="button"
              onClick={startEditing}
              className="text-xs font-medium text-gray-600 dark:text-gray-400 hover:underline"
            >
              Edit name
            </button>
          )}
        </div>
      )}
      <p className="mt-1 font-mono text-xs text-gray-500 dark:text-gray-400">{contract.address}</p>
      <div className="mt-1 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <span>{contract.network}</span>
        {status && (
          <span
            title={status.status === "live" ? "The indexer is updating this network." : status.status === "behind" ? "The indexer is behind the network head." : "No indexer checkpoint exists for this network."}
            className="rounded-full border border-gray-300 dark:border-gray-600 px-2 py-0.5 text-xs font-medium text-gray-700 dark:text-gray-300"
          >
            {status.status === "live" ? "Live" : status.status === "behind" ? `Behind ${status.lag ?? 0} ledgers` : "Not indexed for this network"}
          </span>
        )}
      </div>
    </div>
  );
}
