import type { EventRow, TransferRow } from "@/lib/api";

type CsvRecord = Record<string, string>;

const BASE_EVENT_COLUMNS = ["id", "contract_id", "ledger", "tx_hash", "created_at", "event_type"];

// Spreadsheet apps evaluate cells starting with these characters as formulas.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * Flattens nested objects/arrays into dotted column paths, e.g.
 * `{ amount: "10", to: { address: "G..." } }` -> `{ "value.amount": "10", "value.to.address": "G..." }`.
 */
function flattenInto(target: CsvRecord, prefix: string, value: unknown): void {
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      target[prefix] = "";
      return;
    }
    for (const [key, nested] of entries) {
      flattenInto(target, `${prefix}.${key}`, nested);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      target[prefix] = "";
      return;
    }
    value.forEach((nested, index) => flattenInto(target, `${prefix}.${index}`, nested));
    return;
  }
  target[prefix] = stringifyScalar(value);
}

export function flattenEvent(event: EventRow): CsvRecord {
  const record: CsvRecord = {
    id: String(event.id),
    contract_id: String(event.contractId),
    ledger: String(event.ledger),
    tx_hash: event.txHash,
    created_at: event.createdAt,
    event_type: event.topic
  };

  const decoded = event.decodedData?.decoded;
  if (decoded) {
    // Each topic gets its own column (topic_0, topic_1, ...) rather than one JSON blob.
    decoded.topic.forEach((entry, index) => flattenInto(record, `topic_${index}`, entry));
    if (isPlainObject(decoded.value) || Array.isArray(decoded.value)) {
      flattenInto(record, "value", decoded.value);
    } else {
      record.value = stringifyScalar(decoded.value);
    }
  }

  return record;
}

function compareColumns(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

export function eventsToCsv(events: EventRow[]): string {
  const records = events.map(flattenEvent);

  const dynamicColumns = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!BASE_EVENT_COLUMNS.includes(key)) {
        dynamicColumns.add(key);
      }
    }
  }
  const sortedDynamic = Array.from(dynamicColumns).sort(compareColumns);
  const topicColumns = sortedDynamic.filter((column) => column.startsWith("topic_"));
  const valueColumns = sortedDynamic.filter((column) => !column.startsWith("topic_"));
  const headers = [...BASE_EVENT_COLUMNS, ...topicColumns, ...valueColumns];

  return toCsv(
    headers,
    records.map((record) => headers.map((header) => record[header] ?? ""))
  );
}

export function escapeCsvCell(raw: string): string {
  let value = raw;
  if (FORMULA_PREFIX.test(value) && Number.isNaN(Number(value))) {
    value = `'${value}`;
  }
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsvRows(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}

export function toCsv(headers: string[], rows: string[][]): string {
  return toCsvRows([headers, ...rows]);
}

// Matches the columns shown on the contract transfers table.
export const TRANSFER_CSV_HEADERS = [
  "Sender",
  "Receiver",
  "Amount",
  "Asset",
  "Ledger Timestamp",
  "Tx Hash"
];

/** Serializes transfers to CSV rows (no header line) in `TRANSFER_CSV_HEADERS` order. */
export function transfersToCsvRows(transfers: TransferRow[]): string {
  return toCsvRows(
    transfers.map((transfer) => [
      transfer.from,
      transfer.to,
      transfer.amount,
      transfer.asset,
      transfer.createdAt,
      transfer.txHash
    ])
  );
}

/**
 * Downloads `csv` as a file. Accepts pre-chunked text so large exports can be
 * assembled page by page without concatenating one huge string first.
 */
export function downloadCsv(filename: string, csv: string | string[]): void {
  // Prefix a BOM so Excel detects UTF-8.
  const parts = Array.isArray(csv) ? csv : [csv];
  const blob = new Blob(["﻿", ...parts], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
