"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Contract } from "@/lib/api";
import { loadContracts } from "@/app/(dashboard)/contracts/actions";

type SortKey = "address" | "name" | "network";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "address", label: "Address" },
  { key: "name", label: "Name" },
  { key: "network", label: "Network" }
];

const DEBOUNCE_MS = 300;

export interface ContractsTableProps {
  initialContracts: Contract[];
  initialNextCursor: number | null;
}

export function ContractsTable({ initialContracts, initialNextCursor }: ContractsTableProps) {
  const [contracts, setContracts] = useState<Contract[]>(initialContracts);
  const [nextCursor, setNextCursor] = useState<number | null>(initialNextCursor);
  const [query, setQuery] = useState("");
  const [network, setNetwork] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const skipFirstFilterEffect = useRef(true);

  function handleSort(key: SortKey) {
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" }
    );
  }


    useEffect(() => {
    if (skipFirstFilterEffect.current) {
      skipFirstFilterEffect.current = false;
      return;
    }
    const timer = setTimeout(async () => {
      const id = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      const params: { name?: string; network?: string } = {};
      const trimmedQuery = query.trim();
      if (trimmedQuery) params.name = trimmedQuery;
      const trimmedNetwork = network.trim();
      if (trimmedNetwork) params.network = trimmedNetwork;
      try {
        const page = await loadContracts(params);
        if (id !== requestIdRef.current) return;
        setContracts(page.data);
        setNextCursor(page.nextCursor);
      } catch (e) {
        if (id !== requestIdRef.current) return;
        setError(e instanceof Error ? e.message : "Failed to load contracts.");
      } finally {
        if (id === requestIdRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, network]);

    async function handleLoadMore() {
    if (nextCursor === null || loading) return;
    const id = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    const params: { cursor?: number; name?: string; network?: string } = { cursor: nextCursor };
    const trimmedQuery = query.trim();
    if (trimmedQuery) params.name = trimmedQuery;
    const trimmedNetwork = network.trim();
    if (trimmedNetwork) params.network = trimmedNetwork;
    try {
      const page = await loadContracts(params);
      if (id !== requestIdRef.current) return;
      setContracts((prev) => [...prev, ...page.data]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      if (id !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : "Failed to load more contracts.");
    } finally {
      if (id === requestIdRef.current) setLoading(false);
    }
  }

  const sorted = sort
    ? [...contracts].sort((a, b) => {
        const result = (a[sort.key] ?? "").localeCompare(b[sort.key] ?? "");
        return sort.direction === "asc" ? result : -result;
      })
    : contracts;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="max-w-sm flex-1">
          <label htmlFor="contracts-search" className="sr-only">
            Filter contracts
          </label>
          <input
            id="contracts-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by address or name"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="contracts-network" className="sr-only">
            Filter by network
          </label>
          <input
            id="contracts-network"
            type="text"
            value={network}
            onChange={(event) => setNetwork(event.target.value)}
            placeholder="Network (exact)"
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-left text-sm">
          <caption className="sr-only">
            Registered contracts with address, name and network. Column headers sort the loaded rows.
          </caption>
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              {COLUMNS.map((column) => {
                const direction = sort?.key === column.key ? sort.direction : null;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"
                    }
                    className="py-2 font-medium"
                  >
                    <button
                      type="button"
                      onClick={() => handleSort(column.key)}
                      className="inline-flex items-center gap-1 hover:text-gray-900"
                    >
                      {column.label}
                      <span aria-hidden="true" className={direction ? "" : "text-gray-300"}>
                        {direction === "desc" ? "↓" : "↑"}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((contract) => (
              <tr key={contract.id} className="border-b border-gray-100">
                <td className="py-2 font-mono text-xs">
                  <Link href={`/contracts/${contract.id}`} className="hover:underline">
                    {contract.address}
                  </Link>
                </td>
                <td className="py-2">{contract.name ?? "—"}</td>
                <td className="py-2">{contract.network}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {sorted.length === 0 && !loading && (
        <p className="text-sm text-gray-500">No contracts match the current filters.</p>
      )}

      {nextCursor !== null && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loading}
            className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}