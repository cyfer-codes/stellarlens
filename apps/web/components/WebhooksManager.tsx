"use client";

import { type FormEvent, useEffect, useState } from "react";
import type { Webhook } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";

function parseEventTypes(input: string): string[] | undefined {
  const eventTypes = input
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return eventTypes.length > 0 ? eventTypes : undefined;
}

export function WebhooksManager({ contractId, authenticated }: { contractId: number; authenticated: boolean }) {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [eventTypesInput, setEventTypesInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [justCreatedSecret, setJustCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCopySecret() {
    if (!justCreatedSecret) return;
    try {
      await navigator.clipboard.writeText(justCreatedSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback if clipboard API not available
    }
  }

  async function refresh() {
    try {
      const response = await fetch(`/api/contracts/${contractId}/webhooks`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`request failed with ${response.status}`);
      }
      setWebhooks((await response.json()) as Webhook[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load webhooks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [contractId]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    try {
      const response = await fetch(`/api/contracts/${contractId}/webhooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), eventTypes: parseEventTypes(eventTypesInput) })
      });
      if (!response.ok) {
        throw new Error(`request failed with ${response.status}`);
      }
      const created = (await response.json()) as { secret: string };
      setJustCreatedSecret(created.secret);
      setUrl("");
      setEventTypesInput("");
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to add webhook");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: number) {
    if (typeof window !== "undefined" && !window.confirm("Are you sure you want to delete this webhook?")) {
      return;
    }
    try {
      const response = await fetch(`/api/contracts/${contractId}/webhooks/${id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`request failed with ${response.status}`);
      }
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to delete webhook");
    }
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {justCreatedSecret && (
        <div className="rounded border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            New webhook secret — copy it now, it won&apos;t be shown again:
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="block flex-1 break-all rounded bg-white px-3 py-2 text-xs">{justCreatedSecret}</code>
            <button
              type="button"
              onClick={handleCopySecret}
              className="rounded bg-amber-200 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-300"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {authenticated && (
        <form onSubmit={handleCreate} className="max-w-sm space-y-3">
          <div>
            <label htmlFor="webhook-url" className="block text-sm font-medium text-gray-700">
              URL
            </label>
            <input
              id="webhook-url"
              type="url"
              required
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/webhook"
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="webhook-events" className="block text-sm font-medium text-gray-700">
              Events <span className="text-gray-400">(optional)</span>
            </label>
            <input
              id="webhook-events"
              value={eventTypesInput}
              onChange={(event) => setEventTypesInput(event.target.value)}
              placeholder="transfer, mint"
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">Comma-separated event names. Leave blank to fire on all events.</p>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {creating ? "Adding…" : "Add webhook"}
          </button>
        </form>
      )}

      {loading ? (
        <LoadingState label="Loading webhooks…" />
      ) : webhooks.length === 0 ? (
        <EmptyState
          title="No webhooks yet"
          description="Register one above to get a signed POST whenever this contract emits an event."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <caption className="sr-only">Registered webhooks with URL, event filter and creation date</caption>
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th scope="col" className="py-2 font-medium">URL</th>
                <th scope="col" className="py-2 font-medium">Status</th>
                <th scope="col" className="py-2 font-medium">Events</th>
                <th scope="col" className="py-2 font-medium">Created</th>
                {authenticated && (
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {webhooks.map((webhook) => (
                <tr key={webhook.id} className="border-b border-gray-100">
                  <td className="py-2 font-mono text-xs">{webhook.url}</td>
                  <td className="py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        webhook.active === false
                          ? "bg-gray-100 text-gray-700"
                          : "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20"
                      }`}
                    >
                      {webhook.active === false ? "Inactive" : "Active"}
                    </span>
                  </td>
                  <td className="py-2">{webhook.eventTypes?.length ? webhook.eventTypes.join(", ") : "All events"}</td>
                  <td className="py-2">{new Date(webhook.createdAt).toLocaleString()}</td>
                  {authenticated && (
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(webhook.id)}
                        className="text-xs font-medium text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
