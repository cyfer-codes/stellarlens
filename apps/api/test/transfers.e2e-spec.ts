import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { tokenTransfers } from "@stellarlens/db";
import { createApiKey } from "./helpers";
import { getApp, getTestDb } from "./setup";

describe("transfers (e2e)", () => {
  let apiKey: string;
  let contractId: number;

  beforeEach(async () => {
    apiKey = await createApiKey(getTestDb());
    const contractRes = await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address: "CONTRACT_TRANSFERS_TEST", network: "testnet" });
    contractId = contractRes.body.id;

    const db = getTestDb();
    await db.insert(tokenTransfers).values([
      {
        contractId,
        from: "ADDR_ALICE",
        to: "ADDR_BOB",
        amount: "100",
        asset: "USDC",
        txHash: "TX_HASH_1",
        ledger: 1000
      },
      {
        contractId,
        from: "ADDR_ALICE",
        to: "ADDR_CHARLIE",
        amount: "50",
        asset: "XLM",
        txHash: "TX_HASH_2",
        ledger: 1001
      },
      {
        contractId,
        from: "ADDR_BOB",
        to: "ADDR_CHARLIE",
        amount: "200",
        asset: "USDC",
        txHash: "TX_HASH_3",
        ledger: 1002
      }
    ]);
  });

  it("returns only transfers matching ?asset=USDC", async () => {
    const response = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/transfers?asset=USDC`)
      .set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data.every((t: { asset: string }) => t.asset === "USDC")).toBe(true);
  });

  it("returns all transfers when ?asset is omitted", async () => {
    const response = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/transfers`)
      .set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(3);
  });
});
