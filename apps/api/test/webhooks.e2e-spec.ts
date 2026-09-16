import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApiKey } from "./helpers";
import { getApp, getTestDb } from "./setup";

describe("webhooks (e2e)", () => {
  let apiKey: string;
  let contractId: number;

  beforeEach(async () => {
    apiKey = await createApiKey(getTestDb());
    const contractResponse = await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address: "CONTRACT_WEBHOOK_E2E", network: "testnet" });
    contractId = contractResponse.body.id;
  });

  it("retrieves a single webhook by id without returning secret", async () => {
    const registerResponse = await request(getApp().getHttpServer())
      .post(`/contracts/${contractId}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/webhook" });

    expect(registerResponse.status).toBe(201);
    const webhookId = registerResponse.body.id;

    const getResponse = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/webhooks/${webhookId}`)
      .set("x-api-key", apiKey);

    expect(getResponse.status).toBe(200);
    expect(getResponse.body).toMatchObject({
      id: webhookId,
      url: "https://example.com/webhook"
    });
    expect(getResponse.body.createdAt).toBeDefined();
    expect(getResponse.body.secret).toBeUndefined();
  });

  it("returns 404 for a nonexistent webhook id", async () => {
    const response = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/webhooks/999999`)
      .set("x-api-key", apiKey);

    expect(response.status).toBe(404);
  });

  it("returns 404 when webhook belongs to a different contract", async () => {
    const registerResponse = await request(getApp().getHttpServer())
      .post(`/contracts/${contractId}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/webhook" });

    const webhookId = registerResponse.body.id;

    const otherContract = await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address: "CONTRACT_OTHER_E2E", network: "testnet" });
    const otherContractId = otherContract.body.id;

    const getResponse = await request(getApp().getHttpServer())
      .get(`/contracts/${otherContractId}/webhooks/${webhookId}`)
      .set("x-api-key", apiKey);

    expect(getResponse.status).toBe(404);
  });
});
