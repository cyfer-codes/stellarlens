import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventRecord, ListEventsParams, StellarLensClient, TransferRecord } from "@stellarlens/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportRecords, stateFilePath, type ExportState } from "./export.js";

function event(id: number, overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id,
    contractId: 1,
    ledger: 1000 + id,
    txHash: `tx${id}`,
    topic: "transfer",
    decodedData: {
      id: `evt-${id}`,
      type: "contract",
      ledgerClosedAt: "2026-01-01T00:00:00Z",
      inSuccessfulContractCall: true,
      raw: { topic: [], value: "" },
      decoded: { topic: ["transfer", "GA"], value: String(id * 10) }
    },
    createdAt: `2026-01-${String(id).padStart(2, "0")}T00:00:00.000Z`,
    ...overrides
  };
}

function transfer(id: number): TransferRecord {
  return {
    id,
    contractId: 1,
    from: "GSENDER",
    to: "GRECEIVER",
    amount: String(id),
    asset: "native",
    txHash: `tx${id}`,
    ledger: 2000 + id,
    createdAt: `2026-02-${String(id).padStart(2, "0")}T12:00:00.000Z`
  };
}

/** Mimics the api's `id > cursor` pagination over an in-memory table. */
function paginate<T extends { id: number }>(rows: T[], params: { cursor?: number; limit?: number } = {}) {
  const limit = params.limit ?? 20;
  const after = rows.filter((row) => params.cursor === undefined || row.id > params.cursor);
  const data = after.slice(0, limit);
  return { data, nextCursor: after.length > limit ? data[data.length - 1].id : null };
}

function fakeClient(tables: { events?: EventRecord[]; transfers?: TransferRecord[] }) {
  const listEvents = vi.fn(async (_contractId: number, params?: ListEventsParams) =>
    paginate(tables.events ?? [], params)
  );
  const listTransfers = vi.fn(async (_contractId: number, params?: { cursor?: number; limit?: number }) =>
    paginate(tables.transfers ?? [], params)
  );
  return { client: { listEvents, listTransfers } as unknown as StellarLensClient, listEvents, listTransfers };
}

let dir: string;
let out: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stellarlens-export-"));
  out = join(dir, "export.csv");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function lines(path = out): string[] {
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
}

function state(): ExportState {
  return JSON.parse(readFileSync(stateFilePath(out), "utf8"));
}

describe("exportRecords", () => {
  it("streams every page of events to CSV with a header row", async () => {
    const { client, listEvents } = fakeClient({ events: [1, 2, 3, 4, 5].map((id) => event(id)) });

    const result = await exportRecords(client, "events", 1, { format: "csv", out, pageSize: 2 });

    expect(listEvents).toHaveBeenCalledTimes(3);
    expect(listEvents.mock.calls.map(([, params]) => params?.cursor)).toEqual([undefined, 2, 4]);
    expect(lines()).toEqual([
      "id,contract_id,ledger,tx_hash,created_at,event_type,topic,value",
      ...[1, 2, 3, 4, 5].map(
        (id) =>
          `${id},1,${1000 + id},tx${id},2026-01-0${id}T00:00:00.000Z,transfer,"[""transfer"",""GA""]","""${id * 10}"""`
      )
    ]);
    expect(readFileSync(out, "utf8").endsWith("\r\n")).toBe(true);
    expect(result).toEqual({ rows: 5, totalRows: 5, cursor: 5, resumed: false });
    expect(state()).toMatchObject({ kind: "events", contractId: 1, format: "csv", cursor: 5, rows: 5 });
  });

  it("applies the shared formula-injection protection to CSV cells", async () => {
    const malicious = event(1, { txHash: "=HYPERLINK(\"http://evil\")", topic: "@SUM(A1)" });
    const { client } = fakeClient({ events: [malicious] });

    await exportRecords(client, "events", 1, { format: "csv", out });

    const [, row] = lines();
    expect(row).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(row).toContain(",'@SUM(A1),");
  });

  it("writes NDJSON with one api record per line", async () => {
    const transfers = [1, 2, 3].map(transfer);
    const { client } = fakeClient({ transfers });
    out = join(dir, "transfers.ndjson");

    await exportRecords(client, "transfers", 1, { format: "ndjson", out, pageSize: 2 });

    expect(lines().map((line) => JSON.parse(line))).toEqual(transfers);
  });

  it("writes transfers CSV with machine-readable columns", async () => {
    const { client } = fakeClient({ transfers: [transfer(1)] });

    await exportRecords(client, "transfers", 1, { format: "csv", out });

    expect(lines()).toEqual([
      "id,contract_id,from,to,amount,asset,ledger,tx_hash,created_at",
      "1,1,GSENDER,GRECEIVER,1,native,2001,tx1,2026-02-01T12:00:00.000Z"
    ]);
  });

  it("passes --from/--to to the events endpoint", async () => {
    const { client, listEvents } = fakeClient({ events: [] });

    await exportRecords(client, "events", 7, {
      format: "ndjson",
      out,
      from: "2026-01-01",
      to: "2026-01-31T23:59:59Z"
    });

    expect(listEvents).toHaveBeenCalledWith(7, {
      cursor: undefined,
      limit: 100,
      from: "2026-01-01",
      to: "2026-01-31T23:59:59Z"
    });
  });

  it("filters transfers by date client-side, since the endpoint's from/to mean addresses", async () => {
    const { client, listTransfers } = fakeClient({ transfers: [1, 2, 3, 4, 5].map(transfer) });

    await exportRecords(client, "transfers", 1, {
      format: "ndjson",
      out,
      from: "2026-02-02T00:00:00Z",
      to: "2026-02-04T12:00:00Z",
      pageSize: 2
    });

    expect(listTransfers.mock.calls[0][1]).toEqual({ cursor: undefined, limit: 2 });
    expect(lines().map((line) => JSON.parse(line).id)).toEqual([2, 3, 4]);
    // The cursor still advances past filtered-out records.
    expect(state().cursor).toBe(5);
  });

  it("rejects an unparseable date bound before touching the output", async () => {
    const { client } = fakeClient({ events: [] });

    await expect(exportRecords(client, "events", 1, { format: "csv", out, from: "yesterday" })).rejects.toThrow(
      /--from must be an ISO-8601 date/
    );
  });

  it("only fetches the next page once the previous one is on disk (backpressure)", async () => {
    const rows = Array.from({ length: 30 }, (_, index) => event(index + 1));
    const { client, listEvents } = fakeClient({ events: rows });
    const sizesAtFetch: number[] = [];
    listEvents.mockImplementation(async (_contractId, params) => {
      sizesAtFetch.push(statSync(out).size);
      return paginate(rows, params);
    });

    await exportRecords(client, "events", 1, { format: "csv", out, pageSize: 10 });

    // Each fetch sees a strictly larger file: header first, then each prior page fully written.
    expect(sizesAtFetch).toHaveLength(3);
    expect(sizesAtFetch[0]).toBeGreaterThan(0);
    expect(sizesAtFetch[1]).toBeGreaterThan(sizesAtFetch[0]);
    expect(sizesAtFetch[2]).toBeGreaterThan(sizesAtFetch[1]);
  });

  describe("resume", () => {
    it("continues from the last checkpointed cursor after a failure, without duplicates", async () => {
      const rows = [1, 2, 3, 4, 5].map((id) => event(id));
      const { client, listEvents } = fakeClient({ events: rows });
      listEvents.mockImplementationOnce(async (_id, params) => paginate(rows, params));
      listEvents.mockRejectedValueOnce(new Error("network down"));

      await expect(exportRecords(client, "events", 1, { format: "csv", out, pageSize: 2 })).rejects.toThrow(
        "network down"
      );
      expect(lines()).toHaveLength(3);
      expect(state().cursor).toBe(2);

      const result = await exportRecords(client, "events", 1, { format: "csv", out, pageSize: 2, resume: true });

      expect(result).toEqual({ rows: 3, totalRows: 5, cursor: 5, resumed: true });
      expect(lines().map((line) => line.split(",")[0])).toEqual(["id", "1", "2", "3", "4", "5"]);
    });

    it("drops a partially written page that was never checkpointed", async () => {
      const rows = [1, 2].map((id) => event(id));
      const { client } = fakeClient({ events: rows });
      await exportRecords(client, "events", 1, { format: "ndjson", out, pageSize: 1 });
      appendFileSync(out, '{"id":3,"contractId":1,"led'); // killed mid-write

      rows.push(event(3));
      await exportRecords(client, "events", 1, { format: "ndjson", out, pageSize: 1, resume: true });

      expect(lines().map((line) => JSON.parse(line).id)).toEqual([1, 2, 3]);
    });

    it("appends only newly indexed records when resuming a finished export", async () => {
      const rows = [1, 2].map((id) => event(id));
      const { client, listEvents } = fakeClient({ events: rows });
      await exportRecords(client, "events", 1, { format: "csv", out });

      rows.push(event(3), event(4));
      listEvents.mockClear();
      const result = await exportRecords(client, "events", 1, { format: "csv", out, resume: true });

      expect(listEvents.mock.calls[0][1]?.cursor).toBe(2);
      expect(result.rows).toBe(2);
      expect(lines().filter((line) => line.startsWith("id,"))).toHaveLength(1);
      expect(lines()).toHaveLength(5);
    });

    it("starts fresh when there is no checkpoint yet", async () => {
      const { client } = fakeClient({ events: [event(1)] });

      const result = await exportRecords(client, "events", 1, { format: "csv", out, resume: true });

      expect(result.resumed).toBe(false);
      expect(lines()).toHaveLength(2);
    });

    it("refuses to resume into an export with different parameters", async () => {
      const { client } = fakeClient({ events: [event(1)] });
      await exportRecords(client, "events", 1, { format: "csv", out });

      await expect(
        exportRecords(client, "events", 1, { format: "ndjson", out, resume: true })
      ).rejects.toThrow(/different export \(format: "csv"\)/);
      await expect(exportRecords(client, "events", 2, { format: "csv", out, resume: true })).rejects.toThrow(
        /contractId: 1/
      );
    });

    it("starts over (overwriting the file) without --resume", async () => {
      const { client } = fakeClient({ events: [event(1), event(2)] });
      await exportRecords(client, "events", 1, { format: "csv", out });

      const result = await exportRecords(client, "events", 1, { format: "csv", out });

      expect(result.resumed).toBe(false);
      expect(lines()).toHaveLength(3);
    });
  });
});
