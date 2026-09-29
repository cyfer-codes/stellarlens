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
});
