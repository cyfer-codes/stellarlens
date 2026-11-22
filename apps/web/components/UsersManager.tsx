"use client";

import { type FormEvent, useEffect, useState } from "react";
import type { UserRow } from "@/lib/users";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";

const ROLE_OPTIONS = ["member", "admin"] as const;

export function UsersManager() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<(typeof ROLE_OPTIONS)[number]>("member");
  const [adding, setAdding] = useState(false);

  async function refresh() {
    try {
      const response = await fetch("/api/users", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`request failed with ${response.status}`);
      }
      setUsers((await response.json()) as UserRow[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdding(true);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role })
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `request failed with ${response.status}`);
      }
      setEmail("");
      setPassword("");
      setRole("member");
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to add user");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(id: number) {
    try {
      const response = await fetch(`/api/users/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `request failed with ${response.status}`);
      }
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to remove user");
    }
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <form onSubmit={handleAdd} className="flex max-w-xl flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="new-user-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Email
          </label>
          <input
            id="new-user-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex-1">
          <label htmlFor="new-user-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Password
          </label>
          <input
            id="new-user-password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="new-user-role" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Role
          </label>
          <select
            id="new-user-role"
            value={role}
            onChange={(event) => setRole(event.target.value as (typeof ROLE_OPTIONS)[number])}
            className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm"
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={adding}
          className="rounded bg-gray-900 dark:bg-gray-100 px-4 py-2 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50"
        >
          {adding ? "Adding…" : "Add user"}
        </button>
      </form>

      {loading ? (
        <LoadingState label="Loading users…" />
      ) : users.length === 0 ? (
        <EmptyState title="No users" description="Add a user above to grant dashboard access." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-left text-sm">
            <caption className="sr-only">Users with email, role and actions</caption>
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                <th scope="col" className="py-2 font-medium">Email</th>
                <th scope="col" className="py-2 font-medium">Role</th>
                <th scope="col" className="py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-2">{user.email}</td>
                  <td className="py-2">{user.role}</td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => handleRemove(user.id)}
                      disabled={users.length === 1}
                      aria-label={`Remove ${user.email}`}
                      className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline disabled:cursor-not-allowed disabled:text-gray-400 dark:disabled:text-gray-500 disabled:no-underline"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
