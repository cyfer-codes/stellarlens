import { eq } from "drizzle-orm";
import { nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { contracts, events as eventsTable, indexerCheckpoints, tokenTransfers } from "@stellarlens/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STELLAR_NETWORK as NETWORK } from "../src/config.js";
import { processEventsBatch } from "../src/events.js";
import { redecodeEvents } from "../src/redecode.js";
import { registerContract } from "../src/registry.js";
import { logger } from "../src/logger.js";
import { contractAddress } from "./addresses.js";
import { mockJsonRpc, TEST_RPC_URL } from "./rpc-mocks.js";
import { getTestDb, mswServer } from "./setup.js";

const ADDRESS_A = "GCEHQXSV35ZJRBJR3K4Y4VVO44BJI3NHCFR5HHVG5NCRVRSU4ZLM6T5O";
const ADDRESS_B = "GCK3UYYUG22NJQT2HPLOZL3SREHZP5MLEIKE7LUGLH6XYMB4QEOOXWFD";
// An scvI128 type tag with no body, so `xdr.ScVal.fromXdr` throws.
const MALFORMED_XDR = "AAAACg==";

function symbolXdr(value: string): string {
  return nativeToScVal(value, { type: "symbol" }).toXdr("base64");
}

function addressXdr(address: string): string {
  return nativeToScVal(address, { type: "address" }).toXdr("base64");
}

function i128Xdr(value: bigint): string {
  return nativeToScVal(value, { type: "i128" }).toXdr("base64");
}

function stringXdr(value: string): string {
  return nativeToScVal(value, { type: "string" }).toXdr("base64");
}

function parseLogLine(spy: ReturnType<typeof vi.spyOn>, index = 0): Record<string, unknown> {
  const raw = String(spy.mock.calls[index][0]);
  return JSON.parse(raw) as Record<string, unknown>;
}

interface RawEventFixture {
  id: string;
  ledger: number;
  txHash: string;
  contractId: string;
  topic: string[];
  value: string;
}

function buildRawEvent(overrides: Partial<RawEventFixture> & { contractId: string }): RawEventFixture {
  return {
    id: "0000000000000000000-0000000000",
    ledger: 1000,
    txHash: "a".repeat(64),
    topic: [],
    value: i128Xdr(0n),
    ...overrides
  };
}

function makeServer(): rpc.Server {
  return new rpc.Server(TEST_RPC_URL, { allowHttp: true });
}

function buildLatestLedger(sequence: number) {
  return {
    id: "abc",
    sequence,
    protocolVersion: "21",
    closeTime: "0",
    headerXdr: "AAAAAA==",
    metadataXdr: "AAAAAA=="
  };
}

describe("processEventsBatch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("advances the checkpoint across polls and resumes from the stored cursor", async () => {
    const db = getTestDb();
    await registerContract(db, { address: contractAddress("CONTRACT_A"), network: NETWORK });

    const firstEventsSpy = vi.fn((_params: unknown) => ({
      events: [
        buildRawEvent({
          contractId: contractAddress("CONTRACT_A"),
          topic: [symbolXdr("fee")],
          value: i128Xdr(-100n)
        })
      ],
      cursor: "CURSOR_1",
      latestLedger: 1005
    }));

    mswServer.use(
      mockJsonRpc({
        getLatestLedger: () => buildLatestLedger(1000),
        getEvents: firstEventsSpy
      })
    );

    const server = makeServer();

    await processEventsBatch(db, server);

    expect(firstEventsSpy).toHaveBeenCalledTimes(1);
    const firstCallParams = firstEventsSpy.mock.calls[0][0] as {
      pagination?: { cursor?: string };
      startLedger?: number;
    };
    expect(firstCallParams.pagination?.cursor).toBeUndefined();
    expect(firstCallParams.startLedger).toBe(1000);

    const [afterFirst] = await db
      .select({ cursor: indexerCheckpoints.cursor, latestLedger: indexerCheckpoints.latestLedger })
      .from(indexerCheckpoints)
      .where(eq(indexerCheckpoints.network, NETWORK));
    expect(afterFirst?.cursor).toBe("CURSOR_1");
    expect(afterFirst?.latestLedger).toBe(1005);

    const secondEventsSpy = vi.fn((_params: unknown) => ({ events: [], cursor: "CURSOR_2", latestLedger: 1010 }));

    mswServer.use(
      mockJsonRpc({
        getLatestLedger: () => buildLatestLedger(1000),
        getEvents: secondEventsSpy
      })
    );

    await processEventsBatch(db, server);

    // the second call must resume from the stored cursor, not re-derive startLedger
    expect(secondEventsSpy).toHaveBeenCalledTimes(1);
    const secondCallParams = secondEventsSpy.mock.calls[0][0] as { pagination?: { cursor?: string } };
    expect(secondCallParams.pagination?.cursor).toBe("CURSOR_1");

    const [afterSecond] = await db
      .select({ cursor: indexerCheckpoints.cursor })
      .from(indexerCheckpoints)
      .where(eq(indexerCheckpoints.network, NETWORK));
    expect(afterSecond?.cursor).toBe("CURSOR_2");
  });

  it("decodes event topic and value XDR into native values alongside the raw form", async () => {
    const db = getTestDb();
    await registerContract(db, { address: contractAddress("CONTRACT_B"), network: NETWORK });

    mswServer.use(
      mockJsonRpc({
        getLatestLedger: () => buildLatestLedger(2000),
        getEvents: () => ({
          events: [
            buildRawEvent({
              contractId: contractAddress("CONTRACT_B"),
              ledger: 2005,
              txHash: "b".repeat(64),
              topic: [symbolXdr("fee"), addressXdr(ADDRESS_A)],
              value: i128Xdr(-9741n)
            })
          ],
          cursor: "CURSOR_DECODE",
          latestLedger: 2005
        })
      })
    );

    await processEventsBatch(db, makeServer());

    const [row] = await db.select().from(eventsTable);
    expect(row).toBeDefined();
    expect(row.ledger).toBe(2005);
    expect(row.txHash).toBe("b".repeat(64));
    expect(JSON.parse(row.topic)).toEqual([symbolXdr("fee"), addressXdr(ADDRESS_A)]);

    const decodedData = row.decodedData as {
      raw: { topic: string[]; value: string };
      decoded: { topic: unknown[]; value: unknown };
    };
    expect(decodedData.raw.value).toBe(i128Xdr(-9741n));
    expect(decodedData.decoded.topic).toEqual(["fee", ADDRESS_A]);
    expect(decodedData.decoded.value).toBe("-9741");

    // a non-transfer event must not produce a token_transfers row
    const transferRows = await db.select().from(tokenTransfers);
    expect(transferRows).toHaveLength(0);
  });

  it("detects a SEP-41 transfer event and populates token_transfers", async () => {
    const db = getTestDb();
    await registerContract(db, { address: contractAddress("CONTRACT_C"), network: NETWORK });

    mswServer.use(
      mockJsonRpc({
        getLatestLedger: () => buildLatestLedger(3000),
        getEvents: () => ({
          events: [
            buildRawEvent({
              contractId: contractAddress("CONTRACT_C"),
              ledger: 3010,
              txHash: "c".repeat(64),
              topic: [symbolXdr("transfer"), addressXdr(ADDRESS_A), addressXdr(ADDRESS_B)],
              value: i128Xdr(30000000n)
            })
          ],
          cursor: "CURSOR_TRANSFER",
          latestLedger: 3010
        })
      })
    );

    await processEventsBatch(db, makeServer());

    const [transfer] = await db.select().from(tokenTransfers);
    expect(transfer).toBeDefined();
    expect(transfer.from).toBe(ADDRESS_A);
    expect(transfer.to).toBe(ADDRESS_B);
    expect(transfer.amount).toBe("30000000");
    // no 4th topic: fall back to the emitting contract address
    expect(transfer.asset).toBe(contractAddress("CONTRACT_C"));
    expect(transfer.ledger).toBe(3010);
    expect(transfer.txHash).toBe("c".repeat(64));

    // the generic event row is still recorded alongside the transfer
    const [contract] = await db.select().from(contracts).where(eq(contracts.address, contractAddress("CONTRACT_C")));
    const eventRows = await db.select().from(eventsTable).where(eq(eventsTable.contractId, contract.id));
    expect(eventRows).toHaveLength(1);
  });

  it("stores the SAC asset from topic[3] instead of the contract address", async () => {
    const db = getTestDb();
    await registerContract(db, { address: contractAddress("CONTRACT_SAC"), network: NETWORK });

    mswServer.use(
      mockJsonRpc({
        getLatestLedger: () => buildLatestLedger(3300),
        getEvents: () => ({
          events: [
            buildRawEvent({
              id: "0000000000000003310-0000000001",
              contractId: contractAddress("CONTRACT_SAC"),
              ledger: 3310,
              txHash: "f".repeat(64),
              topic: [
                symbolXdr("transfer"),
                addressXdr(ADDRESS_A),
                addressXdr(ADDRESS_B),
                stringXdr(`USDC:${ADDRESS_A}`)
              ],
              value: i128Xdr(1234n)
            }),
            buildRawEvent({
              id: "0000000000000003311-0000000001",
              contractId: contractAddress("CONTRACT_SAC"),
              ledger: 3311,
              txHash: "0".repeat(64),
              topic: [symbolXdr("transfer"), addressXdr(ADDRESS_A), addressXdr(ADDRESS_B), stringXdr("native")],
              value: i128Xdr(99n)
            })
          ],
          cursor: "CURSOR_SAC",
          latestLedger: 3311
        })
      })
    );

    await processEventsBatch(db, makeServer());

    const transferRows = await db.select().from(tokenTransfers).orderBy(tokenTransfers.ledger);
    expect(transferRows).toHaveLength(2);
    expect(transferRows[0].asset).toBe(`USDC:${ADDRESS_A}`);
    expect(transferRows[0].amount).toBe("1234");
    expect(transferRows[1].asset).toBe("native");
    expect(transferRows[1].amount).toBe("99");
  });

  it("falls back to the contract address when topic[3] is not a string", async () => {
    const db = getTestDb();
    await registerContract(db, { address: contractAddress("CONTRACT_SAC_FALLBACK"), network: NETWORK });

    mswServer.use(
      mockJsonRpc({
        getLatestLedger: () => buildLatestLedger(3350),
        getEvents: () => ({
          events: [
            buildRawEvent({
              contractId: contractAddress("CONTRACT_SAC_FALLBACK"),
              ledger: 3351,
              txHash: "9".repeat(64),
              topic: [symbolXdr("transfer"), addressXdr(ADDRESS_A), addressXdr(ADDRESS_B), i128Xdr(7n)],
              value: i128Xdr(42n)
            })
          ],
          cursor: "CURSOR_SAC_FALLBACK",
          latestLedger: 3351
        })
      })
    );

    await processEventsBatch(db, makeServer());

    const [transfer] = await db.select().from(tokenTransfers);
    expect(transfer.asset).toBe(contractAddress("CONTRACT_SAC_FALLBACK"));
    expect(transfer.amount).toBe("42");
  });

  it("does not insert a duplicate transfer when the ledger range is reprocessed", async () => {
    const db = getTestDb();
    await registerContract(db, { address: contractAddress("CONTRACT_DUPLICATE_TRANSFER"), network: NETWORK });

    mswServer.use(
      mockJsonRpc({
        getLatestLedger: () => buildLatestLedger(3100),
        getEvents: () => ({
          events: [
            buildRawEvent({
              contractId: contractAddress("CONTRACT_DUPLICATE_TRANSFER"),
              ledger: 3110,
              txHash: "d".repeat(64),
              topic: [symbolXdr("transfer"), addressXdr(ADDRESS_A), addressXdr(ADDRESS_B)],
              value: i128Xdr(30000000n)
            })
          ],
          cursor: "CURSOR_DUPLICATE_TRANSFER",
          latestLedger: 3110
        })
      })
    );

    await processEventsBatch(db, makeServer());
    await processEventsBatch(db, makeServer());

    const transferRows = await db.select().from(tokenTransfers);
    expect(transferRows).toHaveLength(1);
  });

  it("keeps every transfer when one transaction emits several from the same token", async () => {
    const db = getTestDb();
    await registerContract(db, { address: contractAddress("CONTRACT_MULTI_TRANSFER"), network: NETWORK });

    mswServer.use(
      mockJsonRpc({
        getLatestLedger: () => buildLatestLedger(3200),
        getEvents: () => ({
          events: [
            buildRawEvent({
              id: "0000000000000003210-0000000001",
              contractId: contractAddress("CONTRACT_MULTI_TRANSFER"),
              ledger: 3210,
              txHash: "e".repeat(64),
              topic: [symbolXdr("transfer"), addressXdr(ADDRESS_A), addressXdr(ADDRESS_B)],
              value: i128Xdr(100n)
            }),
            buildRawEvent({
              id: "0000000000000003210-0000000002",
              contractId: contractAddress("CONTRACT_MULTI_TRANSFER"),
              ledger: 3210,
              txHash: "e".repeat(64),
              topic: [symbolXdr("transfer"), addressXdr(ADDRESS_B), addressXdr(ADDRESS_A)],
              value: i128Xdr(40n)
            })
          ],
          cursor: "CURSOR_MULTI_TRANSFER",
          latestLedger: 3210
        })
      })
    );

    await processEventsBatch(db, makeServer());
    await processEventsBatch(db, makeServer());

    const transferRows = await db.select().from(tokenTransfers);
    expect(transferRows.map((row) => row.amount).sort()).toEqual(["100", "40"]);
  });

  it("skips events from unregistered contracts", async () => {
    const db = getTestDb();
    await registerContract(db, { address: contractAddress("CONTRACT_REGISTERED"), network: NETWORK });

    mswServer.use(
      mockJsonRpc({
        getLatestLedger: () => buildLatestLedger(4000),
        getEvents: () => ({
          events: [
            buildRawEvent({ contractId: contractAddress("CONTRACT_UNREGISTERED"), topic: [symbolXdr("fee")] }),
            buildRawEvent({ contractId: contractAddress("CONTRACT_REGISTERED"), topic: [symbolXdr("fee")] })
          ],
          cursor: "CURSOR_FILTER",
          latestLedger: 4000
        })
      })
    );

    const { indexedCount, cursor } = await processEventsBatch(db, makeServer());

    expect(indexedCount).toBe(1);
    expect(cursor).toBe("CURSOR_FILTER");
    const eventRows = await db.select().from(eventsTable);
    expect(eventRows).toHaveLength(1);

    const contractRows = await db.select().from(contracts);
    expect(contractRows.map((c) => c.address)).toEqual([contractAddress("CONTRACT_REGISTERED")]);
  });

  it("keeps processing the batch when one event has a malformed XDR payload", async () => {
    const db = getTestDb();
    await registerContract(db, { address: contractAddress("CONTRACT_D"), network: NETWORK });
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => { });

    mswServer.use(
      mockJsonRpc({
        getLatestLedger: () => buildLatestLedger(5000),
        getEvents: () => ({
          events: [
            buildRawEvent({
              id: "0000000000000005001-0000000001",
              contractId: contractAddress("CONTRACT_D"),
              ledger: 5001,
              txHash: "1".repeat(64),
              topic: [symbolXdr("fee")],
              value: i128Xdr(-100n)
            }),
            buildRawEvent({
              id: "0000000000000005002-0000000001",
              contractId: contractAddress("CONTRACT_D"),
              ledger: 5002,
              txHash: "2".repeat(64),
              topic: [symbolXdr("fee")],
              value: MALFORMED_XDR
            }),
            buildRawEvent({
              id: "0000000000000005003-0000000001",
              contractId: contractAddress("CONTRACT_D"),
              ledger: 5003,
              txHash: "3".repeat(64),
              topic: [symbolXdr("transfer"), addressXdr(ADDRESS_A), addressXdr(ADDRESS_B)],
              value: i128Xdr(500n)
            })
          ],
          cursor: "CURSOR_MALFORMED",
          latestLedger: 5003
        })
      })
    );

    try {
      const { indexedCount, cursor } = await processEventsBatch(db, makeServer());
      expect(indexedCount).toBe(3);
      expect(cursor).toBe("CURSOR_MALFORMED");

      const eventRows = await db.select().from(eventsTable).orderBy(eventsTable.ledger);
      expect(eventRows.map((row) => row.ledger)).toEqual([5001, 5002, 5003]);

      const [valid, malformed, transferEvent] = eventRows.map(
        (row) =>
          row.decodedData as {
            raw: { topic: string[]; value: string };
            decoded: { topic: unknown[]; value: unknown };
            decodeErrors?: { field: string; error: string }[];
          }
      );

      expect(valid.decoded).toEqual({ topic: ["fee"], value: "-100" });
      expect(valid.decodeErrors).toBeUndefined();

      expect(malformed.raw.value).toBe(MALFORMED_XDR);
      expect(malformed.decoded).toEqual({ topic: ["fee"], value: null });
      expect(malformed.decodeErrors).toEqual([{ field: "value", error: expect.any(String) }]);

      expect(transferEvent.decoded).toEqual({ topic: ["transfer", ADDRESS_A, ADDRESS_B], value: "500" });
      expect(transferEvent.decodeErrors).toBeUndefined();

      const transferRows = await db.select().from(tokenTransfers);
      expect(transferRows).toHaveLength(1);
      expect(transferRows[0].ledger).toBe(5003);
      expect(transferRows[0].amount).toBe("500");

      const [checkpoint] = await db
        .select({ cursor: indexerCheckpoints.cursor })
        .from(indexerCheckpoints)
        .where(eq(indexerCheckpoints.network, NETWORK));
      expect(checkpoint?.cursor).toBe("CURSOR_MALFORMED");

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logLine = parseLogLine(errorSpy);
      expect(logLine.level).toBe("error");
      expect(typeof logLine.msg).toBe("string");
      expect(logLine.contractAddress).toBe(contractAddress("CONTRACT_D"));
      expect(logLine.ledger).toBe(5002);
      expect(logLine.txHash).toBe("2".repeat(64));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("stores null for a malformed topic entry and skips transfer detection", async () => {
    const db = getTestDb();
    await registerContract(db, { address: contractAddress("CONTRACT_E"), network: NETWORK });
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => { });

    mswServer.use(
      mockJsonRpc({
        getLatestLedger: () => buildLatestLedger(6000),
        getEvents: () => ({
          events: [
            buildRawEvent({
              contractId: contractAddress("CONTRACT_E"),
              ledger: 6001,
              topic: [symbolXdr("transfer"), MALFORMED_XDR, addressXdr(ADDRESS_B)],
              value: i128Xdr(700n)
            })
          ],
          cursor: "CURSOR_BAD_TOPIC",
          latestLedger: 6001
        })
      })
    );

    try {
      await processEventsBatch(db, makeServer());

      const [row] = await db.select().from(eventsTable);
      const decodedData = row.decodedData as {
        decoded: { topic: unknown[]; value: unknown };
        decodeErrors?: { field: string }[];
      };
      expect(decodedData.decoded).toEqual({ topic: ["transfer", null, ADDRESS_B], value: "700" });
      expect(decodedData.decodeErrors?.map((e) => e.field)).toEqual(["topic[1]"]);

      expect(await db.select().from(tokenTransfers)).toHaveLength(0);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logLine = parseLogLine(errorSpy);
      expect(logLine.level).toBe("error");
      expect(logLine.contractAddress).toBe(contractAddress("CONTRACT_E"));
      expect(logLine.ledger).toBe(6001);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("re-decodes a previously malformed event and inserts its transfer idempotently", async () => {
    const db = getTestDb();
    await registerContract(db, { address: contractAddress("CONTRACT_REDECODE"), network: NETWORK });
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => { });

    mswServer.use(
      mockJsonRpc({
        getLatestLedger: () => buildLatestLedger(7000),
        getEvents: () => ({
          events: [
            buildRawEvent({
              id: "0000000000000007001-0000000001",
              contractId: contractAddress("CONTRACT_REDECODE"),
              ledger: 7001,
              txHash: "7".repeat(64),
              topic: [symbolXdr("transfer"), addressXdr(ADDRESS_A), addressXdr(ADDRESS_B)],
              value: MALFORMED_XDR
            })
          ],
          cursor: "CURSOR_REDECODE",
          latestLedger: 7001
        })
      })
    );

    await processEventsBatch(db, makeServer());

    const [before] = await db.select().from(eventsTable);
    const beforeData = before.decodedData as { decodeErrors?: { field: string }[] };
    expect(beforeData.decodeErrors?.map((e) => e.field)).toEqual(["value"]);
    expect(await db.select().from(tokenTransfers)).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    // simulate the decoder being fixed: the stored raw XDR is now valid
    await db
      .update(eventsTable)
      .set({
        decodedData: {
          raw: { topic: JSON.parse(before.topic) as string[], value: i128Xdr(500n) },
          decoded: { topic: null, value: null },
          decodeErrors: [{ field: "value", error: "stale" }]
        }
      })
      .where(eq(eventsTable.id, before.id));

    const summary = await redecodeEvents(db, { dryRun: false });
    expect(summary.updated).toBe(1);

    const [after] = await db.select().from(eventsTable);
    const afterData = after.decodedData as {
      decoded: { topic: unknown[]; value: unknown };
      decodeErrors?: unknown[];
    };
    expect(afterData.decodeErrors).toBeUndefined();
    expect(afterData.decoded).toEqual({ topic: ["transfer", ADDRESS_A, ADDRESS_B], value: "500" });

    const transferRows = await db.select().from(tokenTransfers);
    expect(transferRows).toHaveLength(1);
    expect(transferRows[0].amount).toBe("500");

    // running again must not duplicate the transfer
    await redecodeEvents(db, { dryRun: false });
    expect(await db.select().from(tokenTransfers)).toHaveLength(1);

    errorSpy.mockRestore();
  });

  it("returns a null cursor and skips the rpc call when no contracts are registered", async () => {
    const db = getTestDb();

    const getEventsSpy = vi.fn();
    mswServer.use(mockJsonRpc({ getEvents: getEventsSpy }));

    const result = await processEventsBatch(db, makeServer());

    expect(result).toEqual({ indexedCount: 0, cursor: null });
    expect(getEventsSpy).not.toHaveBeenCalled();
  });
});
