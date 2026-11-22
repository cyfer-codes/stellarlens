"use client";

import { type FormEvent, useEffect, useState } from "react";
import type { Webhook, WebhookDelivery } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { CopyButton } from "@/components/ui/CopyButton";

function parseEventTypes(input: string): string[] | undefined {
  const eventTypes = input
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return eventTypes.length > 0 ? eventTypes : undefined;
}

function formatEventTypes(eventTypes: string[] | null): string {
  return eventTypes && eventTypes.length > 0 ? eventTypes.join(", ") : "";
}

interface DeliveriesState {
  expanded: boolean;
  rows: WebhookDelivery[];
  nextCursor: number | null;
  loading: boolean;
  error: string | null;
  loaded: boolean;
}

const EMPTY_DELIVERIES: DeliveriesState = {
  expanded: false,
  rows: [],
  nextCursor: null,
  loading: false,
  error: null,
  loaded: false
};

export function WebhooksManager({ contractId, authenticated }: { contractId: number; authenticated: boolean }) {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  /** Failure of a create/delete/rotate action. */
  const [error, setError] = useState<string | null>(null);
  /** Failure loading the webhook list itself. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [eventTypesInput, setEventTypesInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [justCreatedSecret, setJustCreatedSecret] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Record<number, DeliveriesState>>({});
  const [confirmRotate, setConfirmRotate] = useState<number | null>(null);
  const [rotating, setRotating] = useState<number | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<{ id: number; secret: string } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [editEventTypes, setEditEventTypes] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  function patchDeliveries(id: number, patch: Partial<DeliveriesState>) {
    setDeliveries((current) => {
      const existing = current[id] ?? EMPTY_DELIVERIES;
      return { ...current, [id]: { ...existing, ...patch } };
    });
  }

  async function refresh() {
    try {
      const response = await fetch(`/api/contracts/${contractId}/webhooks`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`request failed with ${response.status}`);
      }
      setWebhooks((await response.json()) as Webhook[]);
      setError(null);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "failed to load webhooks");
    } finally {
      setLoading(false);
    }
  }

  function handleRetryLoad() {
    setLoading(true);
    void refresh();
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
    try {
      const response = await fetch(`/api/contracts/${contractId}/webhooks/${id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`request failed with ${response.status}`);
      }
      setError(null);
      setDeliveries((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      if (editingId === id) {
        resetEditState();
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to delete webhook");
    }
  }

  async function handleRotate(id: number) {
    setRotating(id);
    try {
      const response = await fetch(
        `/api/contracts/${contractId}/webhooks/${id}/rotate-secret`,
        { method: "POST" }
      );
      if (!response.ok) {
        throw new Error(`request failed with ${response.status}`);
      }
      const body = (await response.json()) as { secret: string };
      setRevealedSecret({ id, secret: body.secret });
      setConfirmRotate(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to rotate webhook secret");
    } finally {
      setRotating(null);
    }
  }

  function resetEditState() {
    setEditingId(null);
    setEditUrl("");
    setEditEventTypes("");
    setSavingId(null);
    setEditError(null);
  }

  function handleStartEdit(webhook: Webhook) {
    setEditingId(webhook.id);
    setEditUrl(webhook.url);
    setEditEventTypes(formatEventTypes(webhook.eventTypes));
    setEditError(null);
  }

  function handleCancelEdit() {
    resetEditState();
  }

  async function handleSaveEdit(id: number) {
    const trimmedUrl = editUrl.trim();
    if (!trimmedUrl) {
      setEditError("URL is required");
      return;
    }

    setSavingId(id);
    setEditError(null);
    try {
      const response = await fetch(`/api/contracts/${contractId}/webhooks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: trimmedUrl,
          eventTypes: parseEventTypes(editEventTypes)
        })
      });

      if (response.status === 409) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setEditError(
          body.error
            ? `A webhook with this URL already exists on this contract (${body.error}).`
            : "A webhook with this URL already exists on this contract."
        );
        return;
      }
      if (response.status === 400) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setEditError(body.error ?? "Invalid input.");
        return;
      }
      if (!response.ok) {
        throw new Error(`request failed with ${response.status}`);
      }

      resetEditState();
      await refresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "failed to update webhook");
    } finally {
      setSavingId(null);
    }
  }

  async function fetchDeliveriesPage(id: number, cursor: number | undefined) {
    const query = cursor !== undefined ? `?cursor=${cursor}` : "";
    const response = await fetch(
      `/api/contracts/${contractId}/webhooks/${id}/deliveries${query}`,
      { cache: "no-store" }
    );
    if (!response.ok) {
      throw new Error(`request failed with ${response.status}`);
    }
    return (await response.json()) as { data: WebhookDelivery[]; nextCursor: number | null };
  }

  async function handleToggleDeliveries(id: number) {
    const state = deliveries[id] ?? EMPTY_DELIVERIES;
    if (state.expanded) {
      patchDeliveries(id, { expanded: false });
      return;
    }
    patchDeliveries(id, { expanded: true });
    if (state.loaded) {
      return;
    }
    patchDeliveries(id, { loading: true, error: null });
    try {
      const page = await fetchDeliveriesPage(id, undefined);
      patchDeliveries(id, {
        rows: page.data,
        nextCursor: page.nextCursor,
        loading: false,
        loaded: true
      });
    } catch (err) {
      patchDeliveries(id, {
        loading: false,
        loaded: true,
        error: err instanceof Error ? err.message : "failed to load deliveries"
      });
    }
  }

  async function handleLoadMoreDeliveries(id: number) {
    const state = deliveries[id] ?? EMPTY_DELIVERIES;
    if (state.nextCursor === null || state.loading) return;
    patchDeliveries(id, { loading: true, error: null });
    try {
      const page = await fetchDeliveriesPage(id, state.nextCursor);
      patchDeliveries(id, {
        rows: [...state.rows, ...page.data],
        nextCursor: page.nextCursor,
        loading: false
      });
    } catch (err) {
      patchDeliveries(id, {
        loading: false,
        error: err instanceof Error ? err.message : "failed to load more deliveries"
      });
    }
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loadError && webhooks.length > 0 && (
        <p className="text-sm text-red-600 dark:text-red-400">Couldn&apos;t refresh webhooks: {loadError}</p>
      )}

      {justCreatedSecret && (
        <div className="rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            New webhook secret — copy it now, it won&apos;t be shown again:
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-white dark:bg-gray-900 px-3 py-2 text-xs">{justCreatedSecret}</code>
            <CopyButton value={justCreatedSecret} />
            <button
              type="button"
              onClick={() => setJustCreatedSecret(null)}
              className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {revealedSecret && (
        <div className="rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            Webhook secret rotated — copy it now, it won&apos;t be shown again:
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-white dark:bg-gray-900 px-3 py-2 text-xs">{revealedSecret.secret}</code>
            <CopyButton value={revealedSecret.secret} />
            <button
              type="button"
              onClick={() => setRevealedSecret(null)}
              className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {authenticated && (
        <form onSubmit={handleCreate} className="max-w-sm space-y-3">
          <div>
            <label htmlFor="webhook-url" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              URL
            </label>
            <input
              id="webhook-url"
              type="url"
              required
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/webhook"
              className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="webhook-events" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Events <span className="text-gray-400 dark:text-gray-500">(optional)</span>
            </label>
            <input
              id="webhook-events"
              value={eventTypesInput}
              onChange={(event) => setEventTypesInput(event.target.value)}
              placeholder="transfer, mint"
              className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Comma-separated event names. Leave blank to fire on all events.</p>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="rounded bg-gray-900 dark:bg-gray-100 px-4 py-2 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50"
          >
            {creating ? "Adding…" : "Add webhook"}
          </button>
        </form>
      )}

      {loading ? (
        <LoadingState label="Loading webhooks…" />
      ) : loadError && webhooks.length === 0 ? (
        <ErrorState title="Couldn't load webhooks" message={loadError} onRetry={handleRetryLoad} />
      ) : webhooks.length === 0 ? (
        <EmptyState
          title="No webhooks yet"
          description="Register one above to get a signed POST whenever this contract emits an event."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <caption className="sr-only">
              Registered webhooks with URL, event filter, creation date and recent deliveries
            </caption>
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                <th scope="col" className="py-2 font-medium">URL</th>
                <th scope="col" className="py-2 font-medium">Events</th>
                <th scope="col" className="py-2 font-medium">Created</th>
                <th scope="col" className="py-2 font-medium">Deliveries</th>
                {authenticated && (
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {webhooks.map((webhook) => {
                const state = deliveries[webhook.id] ?? EMPTY_DELIVERIES;
                return (
                  <WebhookRow
                    key={webhook.id}
                    webhook={webhook}
                    state={state}
                    authenticated={authenticated}
                    confirming={confirmRotate === webhook.id}
                    rotating={rotating === webhook.id}
                    editing={editingId === webhook.id}
                    saving={savingId === webhook.id}
                    editUrl={editUrl}
                    editEventTypes={editEventTypes}
                    editError={editingId === webhook.id ? editError : null}
                    onEditUrlChange={setEditUrl}
                    onEditEventTypesChange={setEditEventTypes}
                    onRequestEdit={() => handleStartEdit(webhook)}
                    onCancelEdit={handleCancelEdit}
                    onSaveEdit={() => handleSaveEdit(webhook.id)}
                    onRequestRotate={() => setConfirmRotate(webhook.id)}
                    onCancelRotate={() => setConfirmRotate(null)}
                    onConfirmRotate={() => handleRotate(webhook.id)}
                    onToggleDeliveries={() => handleToggleDeliveries(webhook.id)}
                    onLoadMoreDeliveries={() => handleLoadMoreDeliveries(webhook.id)}
                    onDelete={() => handleDelete(webhook.id)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function WebhookRow({
  webhook,
  state,
  authenticated,
  confirming,
  rotating,
  editing,
  saving,
  editUrl,
  editEventTypes,
  editError,
  onEditUrlChange,
  onEditEventTypesChange,
  onRequestEdit,
  onCancelEdit,
  onSaveEdit,
  onRequestRotate,
  onCancelRotate,
  onConfirmRotate,
  onToggleDeliveries,
  onLoadMoreDeliveries,
  onDelete
}: {
  webhook: Webhook;
  state: DeliveriesState;
  authenticated: boolean;
  confirming: boolean;
  rotating: boolean;
  editing: boolean;
  saving: boolean;
  editUrl: string;
  editEventTypes: string;
  editError: string | null;
  onEditUrlChange: (value: string) => void;
  onEditEventTypesChange: (value: string) => void;
  onRequestEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onRequestRotate: () => void;
  onCancelRotate: () => void;
  onConfirmRotate: () => void;
  onToggleDeliveries: () => void;
  onLoadMoreDeliveries: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <tr className="border-b border-gray-100 dark:border-gray-800">
        <td className="py-2 font-mono text-xs">{webhook.url}</td>
        <td className="py-2">{webhook.eventTypes?.length ? webhook.eventTypes.join(", ") : "All events"}</td>
        <td className="py-2">{new Date(webhook.createdAt).toLocaleString()}</td>
        <td className="py-2">
          <button
            type="button"
            onClick={onToggleDeliveries}
            aria-expanded={state.expanded}
            className="text-xs font-medium text-gray-700 dark:text-gray-300 hover:underline"
          >
            {state.expanded ? "Hide deliveries" : "Show deliveries"}
          </button>
        </td>
        {authenticated && (
          <td className="py-2 text-right">
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onRequestEdit}
                disabled={editing || rotating || confirming}
                className="text-xs font-medium text-gray-700 hover:underline disabled:opacity-50"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={onRequestRotate}
                disabled={rotating || confirming}
                className="text-xs font-medium text-gray-700 dark:text-gray-300 hover:underline disabled:opacity-50"
                disabled={editing || rotating || confirming}
                className="text-xs font-medium text-gray-700 hover:underline disabled:opacity-50"
              >
                Rotate
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
              >
                Delete
              </button>
            </div>
          </td>
        )}
      </tr>
      {editing && (
        <tr className="border-b border-gray-100 bg-gray-50">
          <td colSpan={authenticated ? 5 : 4} className="px-3 py-3">
            <div className="space-y-2">
              <div>
                <label htmlFor={`edit-url-${webhook.id}`} className="block text-xs font-medium text-gray-700">
                  URL
                </label>
                <input
                  id={`edit-url-${webhook.id}`}
                  type="url"
                  value={editUrl}
                  onChange={(event) => onEditUrlChange(event.target.value)}
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor={`edit-events-${webhook.id}`} className="block text-xs font-medium text-gray-700">
                  Events <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  id={`edit-events-${webhook.id}`}
                  value={editEventTypes}
                  onChange={(event) => onEditEventTypesChange(event.target.value)}
                  placeholder="transfer, mint"
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              {editError && <p className="text-xs text-red-600">{editError}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onSaveEdit}
                  disabled={saving}
                  className="rounded bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  disabled={saving}
                  className="rounded border border-gray-300 bg-white px-3 py-1 text-xs hover:bg-gray-100 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
      {confirming && (
        <tr className="border-b border-gray-100 dark:border-gray-800 bg-amber-50 dark:bg-amber-950/40">
          <td colSpan={authenticated ? 5 : 4} className="px-3 py-3">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Rotate webhook secret?</p>
                      <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            <p className="text-sm font-medium text-amber-900">Rotate webhook secret?</p>
            <p className="mt-1 text-xs text-amber-800">
              The current secret will stop working immediately. Any receiver still using the old secret will
              fail signature verification until you deploy the new one. This cannot be undone.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={onConfirmRotate}
                disabled={rotating}
                className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {rotating ? "Rotating…" : "Rotate secret"}
              </button>
              <button
                type="button"
                onClick={onCancelRotate}
                disabled={rotating}
                className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </td>
        </tr>
      )}
      {state.expanded && (
        <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
          <td colSpan={authenticated ? 5 : 4} className="px-3 py-3">
            <DeliveriesPanel state={state} onLoadMore={onLoadMoreDeliveries} />
          </td>
        </tr>
      )}
    </>
  );
}

function DeliveriesPanel({
  state,
  onLoadMore
}: {
  state: DeliveriesState;
  onLoadMore: () => void;
}) {
  if (state.loading && state.rows.length === 0) {
    return <p className="text-xs text-gray-500 dark:text-gray-400">Loading deliveries…</p>;
  }
  if (state.error && state.rows.length === 0) {
    return <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>;
  }
  if (state.loaded && state.rows.length === 0) {
    return <p className="text-xs text-gray-500 dark:text-gray-400">No deliveries yet.</p>;
  }
  return (
    <div className="space-y-2">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
            <th scope="col" className="py-1 font-medium">Status</th>
            <th scope="col" className="py-1 font-medium">Attempts</th>
            <th scope="col" className="py-1 font-medium">Error</th>
            <th scope="col" className="py-1 font-medium">Time</th>
          </tr>
        </thead>
        <tbody>
          {state.rows.map((delivery) => (
            <tr key={delivery.id} className="border-b border-gray-100 dark:border-gray-800">
              <td className="py-1">{delivery.status}</td>
              <td className="py-1">{delivery.attempts}</td>
              <td className="py-1">
                {delivery.lastError ? (
                  <span className="text-red-600 dark:text-red-400">{delivery.lastError}</span>
                ) : (
                  <span className="text-gray-400 dark:text-gray-500">—</span>
                )}
              </td>
              <td className="py-1">{new Date(delivery.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {state.error && state.rows.length > 0 && <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>}
      {state.nextCursor !== null && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={state.loading}
          className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          {state.loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}