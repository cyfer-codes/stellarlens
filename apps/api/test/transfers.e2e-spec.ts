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

  it("searches transfers across contracts by account address", async () => {
    const firstContract = await registerContract(apiKey);
    await seedTransfers(firstContract);
    const secondContract = await registerContract(apiKey);
    await getTestDb().insert(tokenTransfers).values({
      contractId: secondContract,
      from: "OTHER",
      to: "FROM_A",
      amount: "30",
      asset: "OTHER_TOKEN",
      txHash: "c".repeat(64),
      ledger: 1002
    });

    const response = await request(getApp().getHttpServer())
      .get("/transfers")
      .query({ address: "FROM_A" })
      .set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data.every((transfer: { from: string; to: string }) => transfer.from === "FROM_A" || transfer.to === "FROM_A")).toBe(true);
  });

  it("filters transfers by ledger close time, not ingestion time", async () => {
    const contractId = await registerContract(apiKey);
    const closeTime = new Date("2024-03-01T12:00:00.000Z");
    const ingestionTime = new Date("2024-06-01T12:00:00.000Z");

    await getTestDb()
      .insert(tokenTransfers)
      .values([
        {
          contractId,
          from: "FROM_CLOSE",
          to: "TO_CLOSE",
          amount: "1",
          asset: "USDC",
          txHash: "d".repeat(64),
          ledger: 3000,
          closedAt: closeTime,
          createdAt: ingestionTime
        },
        {
          contractId,
          from: "FROM_INGEST",
          to: "TO_INGEST",
          amount: "2",
          asset: "USDC",
          txHash: "e".repeat(64),
          ledger: 3001,
          closedAt: ingestionTime,
          createdAt: closeTime
        }
      ]);

    // Window around the close time should select only the first transfer,
    // even though the second one was ingested during that window.
    const response = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/transfers`)
      .query({
        from: new Date(closeTime.getTime() - 60_000).toISOString(),
        to: new Date(closeTime.getTime() + 60_000).toISOString()
      })
      .set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].from).toBe("FROM_CLOSE");
    expect(response.body.data[0].ledgerClosedAt).toBe(closeTime.toISOString());
  });

  it("filters transfers by minAmount/maxAmount without losing i128 precision", async () => {
    const contractId = await registerContract(apiKey);
    const base = 10n ** 20n;
    const amounts = [base + 1n, base + 2n, base + 3n];

    await getTestDb()
      .insert(tokenTransfers)
      .values(
        amounts.map((amount, index) => ({
          contractId,
          from: `FROM_${index}`,
          to: `TO_${index}`,
          amount: amount.toString(),
          asset: "USDC",
          txHash: String(index + 5).repeat(64),
          ledger: 4000 + index,
          closedAt: T0
        }))
      );

    const response = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/transfers`)
      .query({
        minAmount: (base + 2n).toString(),
        maxAmount: (base + 2n).toString()
      })
      .set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].amount).toBe((base + 2n).toString());

    const rangeResponse = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/transfers`)
      .query({
        minAmount: (base + 2n).toString(),
        maxAmount: (base + 3n).toString()
      })
      .set("x-api-key", apiKey);

    expect(rangeResponse.status).toBe(200);
    expect(rangeResponse.body.data.map((transfer: { amount: string }) => transfer.amount)).toEqual([
      (base + 2n).toString(),
      (base + 3n).toString()
    ]);
  });

  it("rejects minAmount greater than maxAmount", async () => {
    const contractId = await registerContract(apiKey);

    const response = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/transfers`)
      .query({ minAmount: "20", maxAmount: "10" })
      .set("x-api-key", apiKey);

    expect(response.status).toBe(400);
  });

  it("rejects stats with a from date after the to date", async () => {
    const contractId = await registerContract(apiKey);

    const response = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/stats`)
      .query({ from: "2024-02-01T00:00:00.000Z", to: "2024-01-01T00:00:00.000Z" })
      .set("x-api-key", apiKey);

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain("from must be before or equal to to");
  });

  it("accepts stats with valid and single-bound date ranges", async () => {
    const contractId = await registerContract(apiKey);

    for (const query of [
      { from: "2024-01-01T00:00:00.000Z", to: "2024-02-01T00:00:00.000Z" },
      { from: "2024-01-01T00:00:00.000Z", to: "2024-01-01T00:00:00.000Z" },
      { from: "2024-01-01T00:00:00.000Z" },
      { to: "2024-02-01T00:00:00.000Z" }
    ]) {
      const response = await request(getApp().getHttpServer())
        .get(`/contracts/${contractId}/stats`)
        .query(query)
        .set("x-api-key", apiKey);

      expect(response.status).toBe(200);
    }
  });

  it("reports minted and burned totals per kind in stats", async () => {
    const contractId = await registerContract(apiKey);

    await getTestDb()
      .insert(tokenTransfers)
      .values([
        // Rows without an explicit kind default to "transfer".
        {
          contractId,
          from: ACCOUNT_A,
          to: ACCOUNT_B,
          amount: "10",
          asset: "USDC",
          txHash: "1".repeat(64),
          ledger: 5000,
          closedAt: T0
        },
        {
          contractId,
          from: ACCOUNT_B,
          to: ACCOUNT_C,
          amount: "5",
          asset: "USDC",
          txHash: "2".repeat(64),
          ledger: 5001,
          closedAt: T0
        },
        {
          contractId,
          from: null,
          to: ACCOUNT_A,
          amount: "100",
          asset: "USDC",
          kind: "mint",
          txHash: "3".repeat(64),
          ledger: 5002,
          closedAt: T0
        },
        {
          contractId,
          from: null,
          to: ACCOUNT_B,
          amount: "40",
          asset: "USDC",
          kind: "mint",
          txHash: "4".repeat(64),
          ledger: 5003,
          closedAt: T0
        },
        {
          contractId,
          from: ACCOUNT_A,
          to: null,
          amount: "25",
          asset: "USDC",
          kind: "burn",
          txHash: "5".repeat(64),
          ledger: 5004,
          closedAt: T0
        },
        {
          contractId,
          from: ACCOUNT_B,
          to: null,
          amount: "15",
          asset: "USDC",
          kind: "burn",
          txHash: "6".repeat(64),
          ledger: 5005,
          closedAt: T0
        },
        {
          contractId,
          from: ACCOUNT_C,
          to: null,
          amount: "7",
          asset: "USDC",
          kind: "clawback",
          txHash: "7".repeat(64),
          ledger: 5006,
          closedAt: T0
        }
      ]);

    const response = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/stats`)
      .set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(response.body.mintedTotal).toBe("140");
    expect(response.body.burnedTotal).toBe("40");
  });

  it("excludes mint/burn/clawback rows from transfer volume stats", async () => {
    const contractId = await registerContract(apiKey);

    await getTestDb()
      .insert(tokenTransfers)
      .values([
        {
          contractId,
          from: ACCOUNT_A,
          to: ACCOUNT_B,
          amount: "10",
          asset: "USDC",
          txHash: "1".repeat(64),
          ledger: 6000,
          closedAt: T0
        },
        {
          contractId,
          from: null,
          to: ACCOUNT_A,
          amount: "100",
          asset: "USDC",
          kind: "mint",
          txHash: "2".repeat(64),
          ledger: 6001,
          closedAt: T0
        },
        {
          contractId,
          from: ACCOUNT_A,
          to: null,
          amount: "25",
          asset: "USDC",
          kind: "burn",
          txHash: "3".repeat(64),
          ledger: 6002,
          closedAt: T0
        },
        {
          contractId,
          from: ACCOUNT_C,
          to: null,
          amount: "7",
          asset: "USDC",
          kind: "clawback",
          txHash: "4".repeat(64),
          ledger: 6003,
          closedAt: T0
        }
      ]);

    const response = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/stats`)
      .set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(response.body.mintedTotal).toBe("100");
    expect(response.body.burnedTotal).toBe("32");
    expect(response.body.totalVolume).toBe("10");
    expect(response.body.transferCount).toBe(1);
  });
});