import { createWriteStream, type WriteStream } from "node:fs";
import { readFile, rename, rm, stat, truncate, writeFile } from "node:fs/promises";
import {
  toCsvRows,
  type EventRecord,
  type Page,
  type StellarLensClient,
  type TransferRecord
} from "@stellarlens/sdk";

export type ExportKind = "events" | "transfers";
export type ExportFormat = "csv" | "ndjson";

const PAGE_SIZE = 100;
const STATE_VERSION = 1;

export interface ExportOptions {
  format: ExportFormat;
  out: string;
  /** ISO-8601 lower bound on `createdAt` (inclusive). */
  from?: string;
  /** ISO-8601 upper bound on `createdAt` (inclusive). */
  to?: string;
  /** Continue from the cursor saved next to `out` instead of starting over. */
  resume?: boolean;
  pageSize?: number;
}

/**
 * Checkpoint written next to the output after every page. `bytes` is the output length at that point: on
 * resume the file is truncated back to it, so a page that was half-written when the process died is dropped
 * and re-fetched rather than duplicated.
 */
export interface ExportState {
  version: number;
  kind: ExportKind;
  contractId: number;
  format: ExportFormat;
  from: string | null;
  to: string | null;
  cursor: number | null;
  bytes: number;
  rows: number;
}

export interface ExportResult {
  rows: number;
  totalRows: number;
  cursor: number | null;
  resumed: boolean;
}

export const EVENT_CSV_COLUMNS = [
  "id",
  "contract_id",
  "ledger",
  "tx_hash",
  "created_at",
  "event_type",
  "topic",
  "value"
];

export const TRANSFER_CSV_COLUMNS = [
  "id",
  "contract_id",
  "from",
  "to",
  "amount",
  "asset",
  "ledger",
  "tx_hash",
  "created_at"
];

function jsonCell(value: unknown): string {
  return value === undefined ? "" : JSON.stringify(value);
}

// Streaming means the header is written before most rows are seen, so events use fixed columns with the
// decoded topic/value as JSON, rather than the dashboard's per-key flattening (which needs every row up front).
function eventCsvRow(event: EventRecord): string[] {
  const decoded = event.decodedData?.decoded;
  return [
    String(event.id),
    String(event.contractId),
    String(event.ledger),
    event.txHash,
    event.createdAt,
    event.topic,
    decoded ? jsonCell(decoded.topic) : "",
    decoded ? jsonCell(decoded.value) : ""
  ];
}

function transferCsvRow(transfer: TransferRecord): string[] {
  return [
    String(transfer.id),
    String(transfer.contractId),
    transfer.from,
    transfer.to,
    transfer.amount,
    transfer.asset,
    String(transfer.ledger),
    transfer.txHash,
    transfer.createdAt
  ];
}

interface Source<T extends { id: number; createdAt: string }> {
  columns: string[];
  toCsvRow(record: T): string[];
  fetchPage(cursor: number | undefined, limit: number): Promise<Page<T>>;
  /** Client-side date filter, for endpoints that can't filter by date themselves. */
  keep(record: T): boolean;
}

function parseDateBound(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    throw new Error(`${flag} must be an ISO-8601 date or timestamp, got "${value}"`);
  }
  return time;
}

function sourceFor(
  client: StellarLensClient,
  kind: ExportKind,
  contractId: number,
  options: ExportOptions
): Source<EventRecord> | Source<TransferRecord> {
  const from = parseDateBound(options.from, "--from");
  const to = parseDateBound(options.to, "--to");

  if (kind === "events") {
    return {
      columns: EVENT_CSV_COLUMNS,
      toCsvRow: eventCsvRow,
      fetchPage: (cursor, limit) =>
        client.listEvents(contractId, { cursor, limit, from: options.from, to: options.to }),
      keep: () => true
    };
  }

  // The transfers endpoint's `from`/`to` filter on sender/receiver address, not time, so the date window
  // is applied here instead.
  return {
    columns: TRANSFER_CSV_COLUMNS,
    toCsvRow: transferCsvRow,
    fetchPage: (cursor, limit) => client.listTransfers(contractId, { cursor, limit }),
    keep: (transfer: TransferRecord) => {
      const createdAt = Date.parse(transfer.createdAt);
      return (from === undefined || createdAt >= from) && (to === undefined || createdAt <= to);
    }
  };
}

export function stateFilePath(out: string): string {
  return `${out}.cursor.json`;
}

async function readState(path: string): Promise<ExportState | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as ExportState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw new Error(`could not read export checkpoint ${path}: ${(err as Error).message}`);
  }
}

/** Write-then-rename, so a crash mid-write never leaves a corrupt checkpoint behind. */
async function writeState(path: string, state: ExportState): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`);
  await rename(tmp, path);
}

function assertSameExport(state: ExportState, expected: Omit<ExportState, "cursor" | "bytes" | "rows">): void {
  const mismatched = (Object.keys(expected) as (keyof typeof expected)[]).filter(
    (key) => state[key] !== expected[key]
  );
  if (mismatched.length > 0) {
    throw new Error(
      `cannot resume: the checkpoint was written for a different export (${mismatched
        .map((key) => `${key}: ${JSON.stringify(state[key])}`)
        .join(", ")}); rerun without --resume to start over`
    );
  }
}

/**
 * Resolves once `chunk` has been handed to the file. Awaiting this before fetching the next page is what
 * applies backpressure: a slow disk slows the export down instead of buffering pages in memory, and the
 * checkpoint is only advanced past data that has actually been written.
 */
function writeChunk(stream: WriteStream, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let flushed = false;
    let drained = true;
    const done = () => flushed && drained && resolve();

    drained = stream.write(chunk, (err) => {
      if (err) {
        reject(err);
        return;
      }
      flushed = true;
      done();
    });
    if (!drained) {
      stream.once("drain", () => {
        drained = true;
        done();
      });
    }
  });
}

function closeStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.once("error", reject);
    stream.end(() => resolve());
  });
}

/**
 * Streams every page of a contract's events or transfers into `options.out` as CSV or NDJSON, checkpointing
 * the cursor after each page so an interrupted export can continue with `resume`. A finished export can
 * also be resumed later to append only the records indexed since.
 */
export async function exportRecords(
  client: StellarLensClient,
  kind: ExportKind,
  contractId: number,
  options: ExportOptions
): Promise<ExportResult> {
  const source = sourceFor(client, kind, contractId, options) as Source<EventRecord | TransferRecord>;
  const statePath = stateFilePath(options.out);
  const identity = {
    version: STATE_VERSION,
    kind,
    contractId,
    format: options.format,
    from: options.from ?? null,
    to: options.to ?? null
  };

  let state: ExportState | null = options.resume ? await readState(statePath) : null;
  if (state) {
    assertSameExport(state, identity);
    const existing = await stat(options.out).catch(() => null);
    if (!existing) {
      throw new Error(`cannot resume: ${options.out} no longer exists; rerun without --resume to start over`);
    }
    if (existing.size < state.bytes) {
      throw new Error(
        `cannot resume: ${options.out} is shorter than its checkpoint says (${existing.size} < ${state.bytes} bytes)`
      );
    }
    // Drop anything written after the last checkpoint; that page will be fetched again.
    await truncate(options.out, state.bytes);
  } else {
    await rm(statePath, { force: true });
  }

  const resumed = state !== null;
  const stream = createWriteStream(options.out, { flags: resumed ? "a" : "w" });
  let streamError: Error | undefined;
  stream.on("error", (err) => {
    streamError = err;
  });

  let rowsThisRun = 0;
  try {
    if (!state) {
      let bytes = 0;
      if (options.format === "csv") {
        const header = `${toCsvRows([source.columns])}\r\n`;
        await writeChunk(stream, header);
        bytes = Buffer.byteLength(header);
      }
      state = { ...identity, cursor: null, bytes, rows: 0 };
      await writeState(statePath, state);
    }

    const limit = options.pageSize ?? PAGE_SIZE;
    for (;;) {
      const page = await source.fetchPage(state.cursor ?? undefined, limit);
      const records = page.data.filter(source.keep);

      if (records.length > 0) {
        const chunk =
          options.format === "csv"
            ? `${toCsvRows(records.map(source.toCsvRow))}\r\n`
            : records.map((record) => `${JSON.stringify(record)}\n`).join("");
        await writeChunk(stream, chunk);
        state = { ...state, bytes: state.bytes + Buffer.byteLength(chunk), rows: state.rows + records.length };
        rowsThisRun += records.length;
      }

      // Advance to the last record *seen* (filtered or not) so it isn't fetched again. Unlike `nextCursor`,
      // which is null on the final page, this lets a later --resume pick up only newer records.
      if (page.data.length > 0) {
        state = { ...state, cursor: page.data[page.data.length - 1].id };
      }
      await writeState(statePath, state);

      if (page.nextCursor === null || page.data.length === 0) {
        break;
      }
    }
  } finally {
    await closeStream(stream).catch(() => {});
  }

  if (streamError) {
    throw streamError;
  }

  return { rows: rowsThisRun, totalRows: state.rows, cursor: state.cursor, resumed };
}

export async function runExport(
  client: StellarLensClient,
  kind: ExportKind,
  contractId: number,
  options: ExportOptions
): Promise<void> {
  const result = await exportRecords(client, kind, contractId, options);
  console.error(
    `${result.resumed ? "resumed: " : ""}wrote ${result.rows} ${kind} to ${options.out} ` +
      `(${result.totalRows} total, cursor ${result.cursor ?? "none"}; checkpoint ${stateFilePath(options.out)})`
  );
}
