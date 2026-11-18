import { tokenTransfers } from "@stellarlens/db";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { contractAddress, createApiKey } from "./helpers";
import { getApp, getTestDb } from "./setup";

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
});