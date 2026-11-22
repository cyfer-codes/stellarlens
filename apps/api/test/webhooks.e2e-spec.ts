import { eq } from "drizzle-orm";
import { events, webhookDeliveries, webhooks } from "@stellarlens/db";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { contractAddress, createApiKey } from "./helpers";
import { getApp, getTestDb } from "./setup";

async function registerContract(apiKey: string, address: string): Promise<number> {
  const response = await request(getApp().getHttpServer())
    .post("/contracts")
    .set("x-api-key", apiKey)
    .send({ address: contractAddress(address), network: "testnet" });
  return response.body.id;
}

describe("webhooks (e2e)", () => {
  let apiKey: string;

  beforeEach(async () => {
    apiKey = await createApiKey(getTestDb());
  });

  it("registers a webhook and returns its secret once", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_WEBHOOKS_A");

    const response = await request(getApp().getHttpServer())
      .post(`/contracts/${contractId}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/webhook", eventTypes: ["transfer", "mint"] });

    expect(response.status).toBe(201);
    expect(response.body.url).toBe("https://example.com/webhook");
    expect(response.body.eventTypes).toEqual(["transfer", "mint"]);
    expect(typeof response.body.secret).toBe("string");
  });

  it("registers a webhook with structured filter and returns it in list (#257)", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_WEBHOOKS_FILTER_E2E");
    const filter = { topics: ["transfer", null, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"] };

    const response = await request(getApp().getHttpServer())
      .post(`/contracts/${contractId}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/webhook-filter", filter });

    expect(response.status).toBe(201);
    expect(response.body.filter).toEqual(filter);

    const listResponse = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/webhooks`)
      .set("x-api-key", apiKey);

    expect(listResponse.status).toBe(200);
    const item = listResponse.body.find((w: { url: string }) => w.url === "https://example.com/webhook-filter");
    expect(item).toBeDefined();
    expect(item.filter).toEqual(filter);
  });

  it("rejects registering a webhook with an invalid filter shape (#257)", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_WEBHOOKS_FILTER_BAD");

    const response = await request(getApp().getHttpServer())
      .post(`/contracts/${contractId}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/webhook-bad-filter", filter: { topics: [12345] } });

    expect(response.status).toBe(400);
  });

  it("returns 409 registering a url that's already registered for the contract", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_WEBHOOKS_G");
    await request(getApp().getHttpServer())
      .post(`/contracts/${contractId}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/webhook" });

    const response = await request(getApp().getHttpServer())
      .post(`/contracts/${contractId}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/webhook" });
    expect(response.status).toBe(409);

    const listResponse = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/webhooks`)
      .set("x-api-key", apiKey);
    expect(listResponse.body).toHaveLength(1);
  });

  it("allows the same url to be registered for a different contract", async () => {
    const contractA = await registerContract(apiKey, "CONTRACT_WEBHOOKS_H");
    const contractB = await registerContract(apiKey, "CONTRACT_WEBHOOKS_I");
    await request(getApp().getHttpServer())
      .post(`/contracts/${contractA}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/webhook" });

    const response = await request(getApp().getHttpServer())
      .post(`/contracts/${contractB}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/webhook" });
    expect(response.status).toBe(201);
  });

  it("defaults eventTypes to null when omitted, meaning all events", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_WEBHOOKS_B");

    const response = await request(getApp().getHttpServer())
      .post(`/contracts/${contractId}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/webhook" });

    expect(response.status).toBe(201);
    expect(response.body.eventTypes).toBeNull();
  });

  it("lists webhooks for a contract without exposing the secret", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_WEBHOOKS_C");
    await request(getApp().getHttpServer())
      .post(`/contracts/${contractId}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/webhook" });

    const response = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/webhooks`)
      .set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].url).toBe("https://example.com/webhook");
    expect(response.body[0].secret).toBeUndefined();
  });

  it("deletes a webhook", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_WEBHOOKS_D");
    const created = await request(getApp().getHttpServer())
      .post(`/contracts/${contractId}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/webhook" });

    const deleteResponse = await request(getApp().getHttpServer())
      .delete(`/contracts/${contractId}/webhooks/${created.body.id}`)
      .set("x-api-key", apiKey);
    expect(deleteResponse.status).toBe(204);

    const listResponse = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/webhooks`)
      .set("x-api-key", apiKey);
    expect(listResponse.body).toHaveLength(0);
  });

  it("updates webhook configuration without changing its secret", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_WEBHOOKS_PATCH_A");
    const created = await request(getApp().getHttpServer())
      .post(`/contracts/${contractId}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/old", eventTypes: ["transfer"] });

    const response = await request(getApp().getHttpServer())
      .patch(`/contracts/${contractId}/webhooks/${created.body.id}`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/new", eventTypes: ["mint"] });

    const [stored] = await getTestDb()
      .select({ secret: webhooks.secret })
      .from(webhooks)
      .where(eq(webhooks.id, created.body.id));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ url: "https://example.com/new", eventTypes: ["mint"] });
    expect(response.body.secret).toBeUndefined();
    expect(stored.secret).toBe(created.body.secret);
  });

  it("returns 404 when updating a webhook outside its contract or with an unknown id", async () => {
    const contractA = await registerContract(apiKey, "CONTRACT_WEBHOOKS_PATCH_B");
    const contractB = await registerContract(apiKey, "CONTRACT_WEBHOOKS_PATCH_C");
    const created = await request(getApp().getHttpServer())
      .post(`/contracts/${contractA}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/webhook" });

    const otherContractResponse = await request(getApp().getHttpServer())
      .patch(`/contracts/${contractB}/webhooks/${created.body.id}`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/updated" });
    const unknownIdResponse = await request(getApp().getHttpServer())
      .patch(`/contracts/${contractA}/webhooks/999999`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/updated" });

    expect(otherContractResponse.status).toBe(404);
    expect(unknownIdResponse.status).toBe(404);
  });

  it("returns 404 deleting a webhook that doesn't belong to the contract", async () => {
    const contractA = await registerContract(apiKey, "CONTRACT_WEBHOOKS_E");
    const contractB = await registerContract(apiKey, "CONTRACT_WEBHOOKS_F");
    const created = await request(getApp().getHttpServer())
      .post(`/contracts/${contractA}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/webhook" });

    const response = await request(getApp().getHttpServer())
      .delete(`/contracts/${contractB}/webhooks/${created.body.id}`)
      .set("x-api-key", apiKey);

    expect(response.status).toBe(404);
  });

  it("lists deliveries for a webhook with cursor pagination, most recent first", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_WEBHOOKS_J");
    const created = await request(getApp().getHttpServer())
      .post(`/contracts/${contractId}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/webhook" });
    const webhookId = created.body.id;

    const db = getTestDb();
    const [event] = await db
      .insert(events)
      .values({ contractId, ledger: 1, txHash: "a".repeat(64), topic: "[]" })
      .returning({ id: events.id });
    for (let i = 0; i < 3; i += 1) {
      await db.insert(webhookDeliveries).values({
        webhookId,
        eventId: event.id,
        status: i === 2 ? "failed" : "delivered",
        attempts: i + 1,
        lastError: i === 2 ? "connection refused" : null,
        deliveredAt: i === 2 ? null : new Date()
      });
    }

    const firstPage = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/webhooks/${webhookId}/deliveries?limit=2`)
      .set("x-api-key", apiKey);

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.data[0].status).toBe("failed");
    expect(firstPage.body.data[0].attempts).toBe(3);
    expect(firstPage.body.data[0].lastError).toBe("connection refused");
    expect(firstPage.body.data[0].deliveredAt).toBeNull();
    expect(firstPage.body.nextCursor).toBe(firstPage.body.data[1].id);

    const secondPage = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/webhooks/${webhookId}/deliveries?limit=2&cursor=${firstPage.body.nextCursor}`)
      .set("x-api-key", apiKey);

    expect(secondPage.status).toBe(200);
    expect(secondPage.body.data).toHaveLength(1);
    expect(secondPage.body.data[0].attempts).toBe(1);
    expect(secondPage.body.nextCursor).toBeNull();
  });

  it("filters deliveries by status, from and to, and returns eventId", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_WEBHOOKS_FILTERS");
    const created = await request(getApp().getHttpServer())
      .post(`/contracts/${contractId}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/webhook" });
    const webhookId = created.body.id;

    const db = getTestDb();
    const [event] = await db
      .insert(events)
      .values({ contractId, ledger: 1, txHash: "b".repeat(64), topic: "[]" })
      .returning({ id: events.id });

    const base = Date.now();
    const seeded = [
      { status: "delivered", createdAt: new Date(base - 3 * 60 * 60 * 1000) },
      { status: "failed", createdAt: new Date(base - 2 * 60 * 60 * 1000) },
      { status: "delivered", createdAt: new Date(base - 60 * 60 * 1000) },
      { status: "pending", createdAt: new Date(base) }
    ];
    for (const row of seeded) {
      await db.insert(webhookDeliveries).values({
        webhookId,
        eventId: event.id,
        status: row.status,
        attempts: 1,
        createdAt: row.createdAt
      });
    }

    const allResponse = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/webhooks/${webhookId}/deliveries`)
      .set("x-api-key", apiKey);
    expect(allResponse.status).toBe(200);
    expect(allResponse.body.data).toHaveLength(4);
    for (const row of allResponse.body.data) {
      expect(row.eventId).toBe(event.id);
    }

    const statusResponse = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/webhooks/${webhookId}/deliveries?status=failed`)
      .set("x-api-key", apiKey);
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.data).toHaveLength(1);
    expect(statusResponse.body.data[0].status).toBe("failed");
    expect(statusResponse.body.data[0].eventId).toBe(event.id);

    const from = new Date(base - 2.5 * 60 * 60 * 1000).toISOString();
    const to = new Date(base - 0.5 * 60 * 60 * 1000).toISOString();
    const rangeResponse = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/webhooks/${webhookId}/deliveries?from=${from}&to=${to}`)
      .set("x-api-key", apiKey);
    expect(rangeResponse.status).toBe(200);
    expect(rangeResponse.body.data).toHaveLength(2);
    for (const row of rangeResponse.body.data) {
      expect(row.eventId).toBe(event.id);
    }

    const combinedResponse = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/webhooks/${webhookId}/deliveries?status=delivered&from=${from}&to=${to}`)
      .set("x-api-key", apiKey);
    expect(combinedResponse.status).toBe(200);
    expect(combinedResponse.body.data).toHaveLength(1);
    expect(combinedResponse.body.data[0].eventId).toBe(event.id);
  });

  it("returns a health summary for a webhook via the stats endpoint", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_WEBHOOKS_STATS");
    const created = await request(getApp().getHttpServer())
      .post(`/contracts/${contractId}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/webhook" });
    const webhookId = created.body.id;

    const db = getTestDb();
    const [event] = await db
      .insert(events)
      .values({ contractId, ledger: 1, txHash: "c".repeat(64), topic: "[]" })
      .returning({ id: events.id });

    const base = Date.now();
    const lastSuccessAt = new Date(base - 30 * 60 * 1000);
    const lastFailureAt = new Date(base - 10 * 60 * 1000);
    const seeded = [
      { status: "delivered", createdAt: new Date(base - 4 * 60 * 60 * 1000) },
      { status: "failed", createdAt: new Date(base - 3 * 60 * 60 * 1000) },
      { status: "delivered", createdAt: lastSuccessAt },
      { status: "failed", createdAt: new Date(base - 20 * 60 * 1000) },
      { status: "failed", createdAt: lastFailureAt }
    ];
    for (const row of seeded) {
      await db.insert(webhookDeliveries).values({
        webhookId,
        eventId: event.id,
        status: row.status,
        attempts: 1,
        createdAt: row.createdAt
      });
    }

    const response = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/webhooks/${webhookId}/stats?window=24h`)
      .set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      total: 5,
      success: 2,
      failed: 3,
      successRate: 0.4,
      consecutiveFailures: 2
    });
    expect(typeof response.body.lastSuccessAt).toBe("string");
    expect(typeof response.body.lastFailureAt).toBe("string");
    expect(new Date(response.body.lastSuccessAt).getTime()).toBe(lastSuccessAt.getTime());
    expect(new Date(response.body.lastFailureAt).getTime()).toBe(lastFailureAt.getTime());
  });

  it("returns 404 listing deliveries for a webhook that doesn't belong to the contract", async () => {
    const contractA = await registerContract(apiKey, "CONTRACT_WEBHOOKS_K");
    const contractB = await registerContract(apiKey, "CONTRACT_WEBHOOKS_L");
    const created = await request(getApp().getHttpServer())
      .post(`/contracts/${contractA}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/webhook" });

    const response = await request(getApp().getHttpServer())
      .get(`/contracts/${contractB}/webhooks/${created.body.id}/deliveries`)
      .set("x-api-key", apiKey);

    expect(response.status).toBe(404);
  });

  it("rotates a webhook secret, returning the new secret once and leaving config untouched", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_WEBHOOKS_M");
    const created = await request(getApp().getHttpServer())
      .post(`/contracts/${contractId}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/webhook", eventTypes: ["transfer", "mint"] });
    const originalSecret = created.body.secret;

    const rotateResponse = await request(getApp().getHttpServer())
      .post(`/contracts/${contractId}/webhooks/${created.body.id}/rotate-secret`)
      .set("x-api-key", apiKey);

    expect([200, 201]).toContain(rotateResponse.status);
    expect(typeof rotateResponse.body.secret).toBe("string");
    expect(rotateResponse.body.secret.length).toBeGreaterThan(0);
    expect(rotateResponse.body.secret).not.toBe(originalSecret);

    const listResponse = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/webhooks`)
      .set("x-api-key", apiKey);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toHaveLength(1);
    expect(listResponse.body[0].url).toBe("https://example.com/webhook");
    expect(listResponse.body[0].eventTypes).toEqual(["transfer", "mint"]);
    expect(listResponse.body[0].secret).toBeUndefined();
  });

  it("returns 404 rotating the secret of a webhook that doesn't belong to the contract", async () => {
    const contractA = await registerContract(apiKey, "CONTRACT_WEBHOOKS_N");
    const contractB = await registerContract(apiKey, "CONTRACT_WEBHOOKS_O");
    const created = await request(getApp().getHttpServer())
      .post(`/contracts/${contractA}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/webhook" });

    const response = await request(getApp().getHttpServer())
      .post(`/contracts/${contractB}/webhooks/${created.body.id}/rotate-secret`)
      .set("x-api-key", apiKey);

    expect(response.status).toBe(404);
  });
});
