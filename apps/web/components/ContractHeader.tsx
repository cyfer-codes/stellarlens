"use client";

import { type FormEvent, useState } from "react";
import type { Contract } from "@/lib/api";

export function ContractHeader({ contract, authenticated }: { contract: Contract; authenticated: boolean }) {
  const [name, setName] = useState<string | null>(contract.name);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(contract.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
              Name <span className="text-gray-400">(optional)</span>
            </label>
            <input
              id="contract-name"
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder="Contract name"
              autoFocus
              className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="rounded border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{name ?? contract.address}</h1>
          {authenticated && (
            <button
              type="button"
              onClick={startEditing}
              className="text-xs font-medium text-gray-600 hover:underline dark:text-gray-400"
            >
              Edit name
            </button>
          )}
        </div>
      )}
      <p className="mt-1 font-mono text-xs text-gray-500 dark:text-gray-400">{contract.address}</p>
      <p className="text-sm text-gray-500 dark:text-gray-400">{contract.network}</p>
    </div>
  );
}
