"use client";

import { useEffect, useRef, useState } from "react";
import type { TransfersPage } from "@/lib/api";
import { downloadCsv, transfersToCsvRows, TRANSFER_CSV_HEADERS, toCsv } from "@/lib/csvExport";

// The api caps `limit` at 100, so exports walk the cursor in pages of this size.
const EXPORT_PAGE_SIZE = 100;

/**
 * Exports every transfer for a contract as CSV. Pages are fetched one at a
 * time and serialized to CSV text as they arrive, so only the current page's
 * rows are held as objects; the accumulated text chunks become the download.
 */
export function ExportTransfersButton({ contractId }: { contractId: number }) {
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function handleExport() {
    const controller = new AbortController();
    abortRef.current = controller;
    setExporting(true);
    setExportStatus("Preparing export…");

    const chunks = [toCsv(TRANSFER_CSV_HEADERS, [])];
    let cursor: number | null = null;
    let count = 0;

    try {
      do {
        const query = new URLSearchParams({ limit: String(EXPORT_PAGE_SIZE) });
        if (cursor !== null) {
          query.set("cursor", String(cursor));
        }
        const response = await fetch(`/api/contracts/${contractId}/transfers?${query}`, {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`request failed with ${response.status}`);
        }
        const page = (await response.json()) as TransfersPage;
        if (page.data.length > 0) {
          chunks.push(`\r\n${transfersToCsvRows(page.data)}`);
        }
        count += page.data.length;
        setExportStatus(`Fetched ${count} transfers…`);
        cursor = page.nextCursor;
      } while (cursor !== null);

      const date = new Date().toISOString().slice(0, 10);
      downloadCsv(`contract-${contractId}-transfers-${date}.csv`, chunks);
      setExportStatus(`Exported ${count} transfers.`);
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      setExportStatus(`Export failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      if (!controller.signal.aborted) {
        setExporting(false);
      }
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span role="status" aria-live="polite" className="text-xs text-gray-500">
        {exportStatus}
      </span>
      <button
        type="button"
        onClick={handleExport}
        disabled={exporting}
        aria-label="Export CSV of all transfers for this contract"
        className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {exporting ? "Exporting…" : "Export CSV"}
      </button>
    </div>
  );
}
