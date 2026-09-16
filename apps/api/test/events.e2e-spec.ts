import { events } from "@stellarlens/db";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApiKey } from "./helpers";
import { getApp, getTestDb } from "./setup";

async function registerContract(apiKey: string, address: string): Promise<number> {
  const response = await request(getApp().getHttpServer())
    .post("/contracts")
    .set("x-api-key", apiKey)
    .send({ address, network: "testnet" });
  return response.body.id;
}

async function seedEvents(contractId: number, count: number) {
  const db = getTestDb();
  for (let i = 0; i < count; i += 1) {
    await db.insert(events).values({
      contractId,
      ledger: 1000 + i,
      txHash: i.toString().repeat(64).slice(0, 64),
      topic: JSON.stringify(["fee"])
    });
  }
}

describe("events (e2e)", () => {
  let apiKey: string;

  beforeEach(async () => {
    apiKey = await createApiKey(getTestDb());
  });

  it("paginates events for a contract using the cursor", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_EVENTS_A");
    await seedEvents(contractId, 5);

    const firstPage = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/events`)
      .query({ limit: 2 })
      .set("x-api-key", apiKey);

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.data[0].ledger).toBe(1000);
    expect(firstPage.body.data[1].ledger).toBe(1001);
    expect(firstPage.body.nextCursor).toBe(firstPage.body.data[1].id);

    const secondPage = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/events`)
      .query({ limit: 2, cursor: firstPage.body.nextCursor })
      .set("x-api-key", apiKey);

    expect(secondPage.body.data).toHaveLength(2);
    expect(secondPage.body.data[0].ledger).toBe(1002);
    expect(secondPage.body.data[1].ledger).toBe(1003);
    expect(secondPage.body.nextCursor).toBe(secondPage.body.data[1].id);

    const thirdPage = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/events`)
      .query({ limit: 2, cursor: secondPage.body.nextCursor })
      .set("x-api-key", apiKey);

    expect(thirdPage.body.data).toHaveLength(1);
    expect(thirdPage.body.data[0].ledger).toBe(1004);
    expect(thirdPage.body.nextCursor).toBeNull();
  });

  it("scopes events to the requested contract only", async () => {
    const contractA = await registerContract(apiKey, "CONTRACT_EVENTS_B");
    const contractB = await registerContract(apiKey, "CONTRACT_EVENTS_C");
    await seedEvents(contractA, 2);
    await seedEvents(contractB, 3);

    const response = await request(getApp().getHttpServer())
      .get(`/contracts/${contractA}/events`)
      .set("x-api-key", apiKey);

    expect(response.body.data).toHaveLength(2);
    expect(response.body.data.every((event: { contractId: number }) => event.contractId === contractA)).toBe(true);
  });

  it("returns 404 when the contract does not exist", async () => {
    const response = await request(getApp().getHttpServer()).get("/contracts/999999/events").set("x-api-key", apiKey);
    expect(response.status).toBe(404);
  });

  it("returns 400 when 'from' is after 'to'", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_EVENTS_D");
    const response = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/events`)
      .query({ from: "2026-02-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" })
      .set("x-api-key", apiKey);

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain("'from' must be before or equal to 'to'");
  });
});
