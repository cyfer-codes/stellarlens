import { webhookDeliveries } from "@stellarlens/db";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiKey } from "./helpers";
import { getApp, getTestDb } from "./setup";

async function registerContract(apiKey: string, address: string): Promise<number> {
  const response = await request(getApp().getHttpServer())
    .post("/contracts")
    .set("x-api-key", apiKey)
    .send({ address, network: "testnet" });
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
    for (let i = 0; i < 3; i += 1) {
      await db.insert(webhookDeliveries).values({
        webhookId,
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

  describe("url scheme", () => {
    const originalAllowInsecure = process.env.ALLOW_INSECURE_WEBHOOK_URLS;

    afterEach(() => {
      if (originalAllowInsecure === undefined) {
        delete process.env.ALLOW_INSECURE_WEBHOOK_URLS;
      } else {
        process.env.ALLOW_INSECURE_WEBHOOK_URLS = originalAllowInsecure;
      }
    });

    it("rejects a plain http:// url with a descriptive error", async () => {
      delete process.env.ALLOW_INSECURE_WEBHOOK_URLS;
      const contractId = await registerContract(apiKey, "CONTRACT_WEBHOOKS_M");

      const response = await request(getApp().getHttpServer())
        .post(`/contracts/${contractId}/webhooks`)
        .set("x-api-key", apiKey)
        .send({ url: "http://example.com/webhook" });

      expect(response.status).toBe(400);
      expect(response.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining("url must use https://")])
      );
    });

    it("rejects http:// when ALLOW_INSECURE_WEBHOOK_URLS is set to anything other than true", async () => {
      process.env.ALLOW_INSECURE_WEBHOOK_URLS = "1";
      const contractId = await registerContract(apiKey, "CONTRACT_WEBHOOKS_N");

      const response = await request(getApp().getHttpServer())
        .post(`/contracts/${contractId}/webhooks`)
        .set("x-api-key", apiKey)
        .send({ url: "http://localhost:4000/webhook" });

      expect(response.status).toBe(400);
    });

    it("accepts an https:// url", async () => {
      delete process.env.ALLOW_INSECURE_WEBHOOK_URLS;
      const contractId = await registerContract(apiKey, "CONTRACT_WEBHOOKS_O");

      const response = await request(getApp().getHttpServer())
        .post(`/contracts/${contractId}/webhooks`)
        .set("x-api-key", apiKey)
        .send({ url: "https://example.com/webhook" });

      expect(response.status).toBe(201);
    });

    it("accepts an http:// url when ALLOW_INSECURE_WEBHOOK_URLS=true for local development", async () => {
      process.env.ALLOW_INSECURE_WEBHOOK_URLS = "true";
      const contractId = await registerContract(apiKey, "CONTRACT_WEBHOOKS_P");

      const response = await request(getApp().getHttpServer())
        .post(`/contracts/${contractId}/webhooks`)
        .set("x-api-key", apiKey)
        .send({ url: "http://localhost:4000/webhook" });

      expect(response.status).toBe(201);
      expect(response.body.url).toBe("http://localhost:4000/webhook");
    });
  });
});
