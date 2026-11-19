import { tokenTransfers } from "@stellarlens/db";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { contractAddress, createApiKey } from "./helpers";
import { getApp, getTestDb } from "./setup";

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