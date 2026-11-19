import { tokenTransfers } from "@stellarlens/db";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { contractAddress, createApiKey } from "./helpers";
import { getApp, getTestDb } from "./setup";

// Valid Stellar strkeys (ed25519 public key and contract address).
const ACCOUNT_A = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ACCOUNT_B = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const ACCOUNT_C = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const CONTRACT_STRKEY = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const INVALID_STRKEY = "not-a-valid-strkey";
async function seedManyTransfers(contractId: number, count: number) {
  await getTestDb()
    .insert(tokenTransfers)
    .values(
      Array.from({ length: count }, (_, index) => ({
        contractId,
        from: `FROM_${index}`,
        to: `TO_${index}`,
        amount: String(index + 1),
        asset: "USDC",
        txHash: String(index % 10).repeat(64),
        ledger: 2000 + index
      }))
    );
}

async function registerContract(apiKey: string): Promise<number> {
  const response = await request(getApp().getHttpServer())
    .post("/contracts")
    .set("x-api-key", apiKey)
    .send({ address: contractAddress("CONTRACT_TRANSFERS_A"), network: "testnet" });
  return response.body.id;
}

async function registerContractWithAddress(apiKey: string, address: string): Promise<number> {
  const response = await request(getApp().getHttpServer())
    .post("/contracts")
    .set("x-api-key", apiKey)
    .send({ address, network: "testnet" });
  return response.body.id;
}

async function seedTransfers(contractId: number) {
  await getTestDb()
    .insert(tokenTransfers)
    .values([
      {
        contractId,
        from: "FROM_A",
        to: "TO_A",
        amount: "10",
        asset: "USDC",
        txHash: "a".repeat(64),
        ledger: 1000
      },
      {
        contractId,
        from: "FROM_B",
        to: "TO_B",
        amount: "20",
        asset: "XLM",
        txHash: "b".repeat(64),
        ledger: 1001
      }
    ]);
}

// Ledger close times used for bucketing. 2024-01-01T00:00:00Z and friends.
const T0 = new Date("2024-01-01T00:00:00.000Z");
const T0_PLUS_30M = new Date("2024-01-01T00:30:00.000Z");
const T0_PLUS_90M = new Date("2024-01-01T01:30:00.000Z");
const T1 = new Date("2024-01-02T05:00:00.000Z");

async function seedVolumeTransfers(contractId: number) {
  await getTestDb()
    .insert(tokenTransfers)
    .values([
      // Same hour bucket as T0_PLUS_30M (00:00 hour), USDC.
      {
        contractId,
        from: ACCOUNT_A,
        to: ACCOUNT_B,
        amount: "10",
        asset: "USDC",
        txHash: "1".repeat(64),
        ledger: 2000,
        closedAt: T0
      },
      {
        contractId,
        from: ACCOUNT_A,
        to: ACCOUNT_C,
        amount: "5",
        asset: "USDC",
        txHash: "2".repeat(64),
        ledger: 2001,
        closedAt: T0_PLUS_30M
      },
      // Next hour bucket, USDC.
      {
        contractId,
        from: ACCOUNT_B,
        to: ACCOUNT_C,
        amount: "7",
        asset: "USDC",
        txHash: "3".repeat(64),
        ledger: 2002,
        closedAt: T0_PLUS_90M
      },
      // Different day, XLM.
      {
        contractId,
        from: ACCOUNT_C,
        to: ACCOUNT_A,
        amount: "100",
        asset: "XLM",
        txHash: "4".repeat(64),
        ledger: 2003,
        closedAt: T1
      }
    ]);
}

describe("transfers (e2e)", () => {
  let apiKey: string;

  beforeEach(async () => {
    apiKey = await createApiKey(getTestDb());
  });

  it("returns all assets by default and filters by asset when requested", async () => {
    const contractId = await registerContract(apiKey);
    await seedTransfers(contractId);

    const unfilteredResponse = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/transfers`)
      .set("x-api-key", apiKey);

    expect(unfilteredResponse.status).toBe(200);
    expect(unfilteredResponse.body.data).toHaveLength(2);
    expect(unfilteredResponse.body.data.map((transfer: { asset: string }) => transfer.asset)).toEqual(["USDC", "XLM"]);

    const filteredResponse = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/transfers`)
      .query({ asset: "USDC" })
      .set("x-api-key", apiKey);

    expect(filteredResponse.status).toBe(200);
    expect(filteredResponse.body.data).toHaveLength(1);
    expect(filteredResponse.body.data[0].asset).toBe("USDC");
  });

  describe("GET /contracts/:id/stats/volume", () => {
    it("buckets volume by hour using date_trunc on ledger close time", async () => {
      const contractId = await registerContract(apiKey);
      await seedVolumeTransfers(contractId);

      const response = await request(getApp().getHttpServer())
        .get(`/contracts/${contractId}/stats/volume`)
        .query({
          interval: "hour",
          from: T0.toISOString(),
          to: T1.toISOString(),
          asset: "USDC"
        })
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        { bucket: "2024-01-01T00:00:00.000Z", volume: "15", count: 2 },
        { bucket: "2024-01-01T01:00:00.000Z", volume: "7", count: 1 }
      ]);
    });

    it("buckets volume by day and aggregates across hours", async () => {
      const contractId = await registerContract(apiKey);
      await seedVolumeTransfers(contractId);

      const response = await request(getApp().getHttpServer())
        .get(`/contracts/${contractId}/stats/volume`)
        .query({
          interval: "day",
          from: T0.toISOString(),
          to: T1.toISOString(),
          asset: "USDC"
        })
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([{ bucket: "2024-01-01T00:00:00.000Z", volume: "22", count: 3 }]);
    });

    it("omits empty buckets (documented behavior)", async () => {
      const contractId = await registerContract(apiKey);
      await seedVolumeTransfers(contractId);

      const response = await request(getApp().getHttpServer())
        .get(`/contracts/${contractId}/stats/volume`)
        .query({
          interval: "hour",
          from: T0.toISOString(),
          to: T1.toISOString(),
          asset: "USDC"
        })
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      // Only buckets with transfers are returned; there is no zero-filled
      // bucket for the gap between 01:00 and the next day.
      const buckets = response.body.map((row: { bucket: string }) => row.bucket);
      expect(buckets).toEqual(["2024-01-01T00:00:00.000Z", "2024-01-01T01:00:00.000Z"]);
    });

    it("rejects requests that would produce too many buckets", async () => {
      const contractId = await registerContract(apiKey);

      const response = await request(getApp().getHttpServer())
        .get(`/contracts/${contractId}/stats/volume`)
        .query({
          interval: "hour",
          from: "2020-01-01T00:00:00.000Z",
          to: "2024-01-01T00:00:00.000Z"
        })
        .set("x-api-key", apiKey);

      expect(response.status).toBe(400);
    });

    it("rejects an invalid interval", async () => {
      const contractId = await registerContract(apiKey);

      const response = await request(getApp().getHttpServer())
        .get(`/contracts/${contractId}/stats/volume`)
        .query({ interval: "minute", from: T0.toISOString(), to: T1.toISOString() })
        .set("x-api-key", apiKey);

      expect(response.status).toBe(400);
    });
  });

  describe("GET /contracts/:id/stats/top-accounts", () => {
    it("ranks senders by volume with counts", async () => {
      const contractId = await registerContract(apiKey);
      await seedVolumeTransfers(contractId);

      const response = await request(getApp().getHttpServer())
        .get(`/contracts/${contractId}/stats/top-accounts`)
        .query({ direction: "from", from: T0.toISOString(), to: T1.toISOString() })
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        { account: ACCOUNT_C, volume: "100", count: 1 },
        { account: ACCOUNT_A, volume: "15", count: 2 },
        { account: ACCOUNT_B, volume: "7", count: 1 }
      ]);
    });

    it("ranks receivers by volume with counts", async () => {
      const contractId = await registerContract(apiKey);
      await seedVolumeTransfers(contractId);

      const response = await request(getApp().getHttpServer())
        .get(`/contracts/${contractId}/stats/top-accounts`)
        .query({ direction: "to", from: T0.toISOString(), to: T1.toISOString() })
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        { account: ACCOUNT_A, volume: "100", count: 1 },
        { account: ACCOUNT_C, volume: "12", count: 2 },
        { account: ACCOUNT_B, volume: "10", count: 1 }
      ]);
    });

    it("enforces the limit", async () => {
      const contractId = await registerContract(apiKey);
      await seedVolumeTransfers(contractId);

      const response = await request(getApp().getHttpServer())
        .get(`/contracts/${contractId}/stats/top-accounts`)
        .query({ direction: "from", limit: 1, from: T0.toISOString(), to: T1.toISOString() })
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].account).toBe(ACCOUNT_C);
    });

    it("rejects an invalid direction", async () => {
      const contractId = await registerContract(apiKey);

      const response = await request(getApp().getHttpServer())
        .get(`/contracts/${contractId}/stats/top-accounts`)
        .query({ direction: "sideways" })
        .set("x-api-key", apiKey);

      expect(response.status).toBe(400);
    });
  });

  describe("GET /accounts/:address/transfers", () => {
    async function seedAccountTransfers() {
      const contractA = await registerContractWithAddress(apiKey, CONTRACT_STRKEY);
      const contractB = await registerContractWithAddress(
        apiKey,
        contractAddress("CONTRACT_TRANSFERS_B")
      );

      await getTestDb()
        .insert(tokenTransfers)
        .values([
          {
            contractId: contractA,
            from: ACCOUNT_A,
            to: ACCOUNT_B,
            amount: "1",
            asset: "USDC",
            txHash: "c".repeat(64),
            ledger: 3000,
            closedAt: T0
          },
          {
            contractId: contractB,
            from: ACCOUNT_C,
            to: ACCOUNT_A,
            amount: "2",
            asset: "USDC",
            txHash: "d".repeat(64),
            ledger: 3001,
            closedAt: T0_PLUS_30M
          },
          {
            contractId: contractA,
            from: ACCOUNT_A,
            to: ACCOUNT_C,
            amount: "3",
            asset: "XLM",
            txHash: "e".repeat(64),
            ledger: 3002,
            closedAt: T0_PLUS_90M
          }
        ]);
    }

    it("rejects an invalid strkey", async () => {
      const response = await request(getApp().getHttpServer())
        .get(`/accounts/${INVALID_STRKEY}/transfers`)
        .set("x-api-key", apiKey);

      expect(response.status).toBe(400);
    });

    it("returns both directions across contracts by default", async () => {
      await seedAccountTransfers();

      const response = await request(getApp().getHttpServer())
        .get(`/accounts/${ACCOUNT_A}/transfers`)
        .query({ direction: "both" })
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(3);
    });

    it("filters to outgoing transfers", async () => {
      await seedAccountTransfers();

      const response = await request(getApp().getHttpServer())
        .get(`/accounts/${ACCOUNT_A}/transfers`)
        .query({ direction: "out" })
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      expect(
        response.body.data.every((transfer: { from: string }) => transfer.from === ACCOUNT_A)
      ).toBe(true);
    });

    it("filters to incoming transfers", async () => {
      await seedAccountTransfers();

      const response = await request(getApp().getHttpServer())
        .get(`/accounts/${ACCOUNT_A}/transfers`)
        .query({ direction: "in" })
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].to).toBe(ACCOUNT_A);
    });

    it("paginates with a cursor", async () => {
      await seedAccountTransfers();

      const firstPage = await request(getApp().getHttpServer())
        .get(`/accounts/${ACCOUNT_A}/transfers`)
        .query({ direction: "both", limit: 2 })
        .set("x-api-key", apiKey);

      expect(firstPage.status).toBe(200);
      expect(firstPage.body.data).toHaveLength(2);
      expect(firstPage.body.nextCursor).toBeTruthy();

      const secondPage = await request(getApp().getHttpServer())
        .get(`/accounts/${ACCOUNT_A}/transfers`)
        .query({ direction: "both", limit: 2, cursor: firstPage.body.nextCursor })
        .set("x-api-key", apiKey);

      expect(secondPage.status).toBe(200);
      expect(secondPage.body.data).toHaveLength(1);

      const firstIds = firstPage.body.data.map((transfer: { id: number }) => transfer.id);
      const secondIds = secondPage.body.data.map((transfer: { id: number }) => transfer.id);
      expect(firstIds.some((id: number) => secondIds.includes(id))).toBe(false);
    });
  it("pages transfers newest-first with order=desc and follows the cursor", async () => {
    const contractId = await registerContract(apiKey);
    await seedManyTransfers(contractId, 5);

    const firstPage = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/transfers`)
      .query({ order: "desc", limit: 2 })
      .set("x-api-key", apiKey);

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data.map((transfer: { ledger: number }) => transfer.ledger)).toEqual([2004, 2003]);
    expect(firstPage.body.nextCursor).toBeTruthy();

    const secondPage = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/transfers`)
      .query({ order: "desc", limit: 2, cursor: firstPage.body.nextCursor })
      .set("x-api-key", apiKey);

    expect(secondPage.status).toBe(200);
    expect(secondPage.body.data.map((transfer: { ledger: number }) => transfer.ledger)).toEqual([2002, 2001]);

    const thirdPage = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/transfers`)
      .query({ order: "desc", limit: 2, cursor: secondPage.body.nextCursor })
      .set("x-api-key", apiKey);

    expect(thirdPage.status).toBe(200);
    expect(thirdPage.body.data.map((transfer: { ledger: number }) => transfer.ledger)).toEqual([2000]);

    const seen = [
      ...firstPage.body.data,
      ...secondPage.body.data,
      ...thirdPage.body.data
    ].map((transfer: { ledger: number }) => transfer.ledger);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual([2004, 2003, 2002, 2001, 2000]);
  });

  it("keeps ascending order by default", async () => {
    const contractId = await registerContract(apiKey);
    await seedManyTransfers(contractId, 3);

    const response = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/transfers`)
      .query({ limit: 2 })
      .set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(response.body.data.map((transfer: { ledger: number }) => transfer.ledger)).toEqual([2000, 2001]);

    const nextPage = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/transfers`)
      .query({ limit: 2, cursor: response.body.nextCursor })
      .set("x-api-key", apiKey);

    expect(nextPage.status).toBe(200);
    expect(nextPage.body.data.map((transfer: { ledger: number }) => transfer.ledger)).toEqual([2002]);
  });

  it("looks up transfers by transaction hash", async () => {
    const contractId = await registerContract(apiKey);
    await seedManyTransfers(contractId, 3);

    const hash = "1".repeat(64);
    const response = await request(getApp().getHttpServer())
      .get(`/transactions/${hash}`)
      .set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(response.body.transfers).toHaveLength(1);
    expect(response.body.transfers[0].txHash).toBe(hash);
    expect(response.body.transfers[0].contractId).toBe(contractId);
  });

  it("returns empty results for an unknown transaction hash", async () => {
    const hash = "f".repeat(64);
    const response = await request(getApp().getHttpServer())
      .get(`/transactions/${hash}`)
      .set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(response.body.events).toEqual([]);
    expect(response.body.transfers).toEqual([]);
  });

  it("rejects a malformed transaction hash", async () => {
    const response = await request(getApp().getHttpServer())
      .get("/transactions/not-a-hash")
      .set("x-api-key", apiKey);

    expect(response.status).toBe(400);
  });
});