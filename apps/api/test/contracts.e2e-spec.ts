import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { contractAddress, createApiKey } from "./helpers";
import { getApp, getTestDb } from "./setup";

describe("contracts (e2e)", () => {
  let apiKey: string;

  beforeEach(async () => {
    apiKey = await createApiKey(getTestDb());
  });

  it("registers a new contract", async () => {
    const response = await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address: contractAddress("CONTRACT_REGISTER_A"), network: "testnet", name: "My Contract" });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      address: contractAddress("CONTRACT_REGISTER_A"),
      network: "testnet",
      name: "My Contract"
    });
    expect(response.body.id).toBeDefined();
  });

  it("persists the registered contract, retrievable by id", async () => {
    const registerResponse = await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address: contractAddress("CONTRACT_REGISTER_B"), network: "testnet" });

    const contractId = registerResponse.body.id;

    const getResponse = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}`)
      .set("x-api-key", apiKey);

    expect(getResponse.status).toBe(200);
    expect(getResponse.body).toMatchObject({ id: contractId, address: contractAddress("CONTRACT_REGISTER_B") });
  });

  it("upserts on re-registering the same address", async () => {
    await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address: contractAddress("CONTRACT_REGISTER_C"), network: "testnet", name: "Original" });

    const updateResponse = await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address: contractAddress("CONTRACT_REGISTER_C"), network: "testnet", name: "Renamed" });

    expect(updateResponse.status).toBe(201);
    expect(updateResponse.body.name).toBe("Renamed");

    const listResponse = await request(getApp().getHttpServer()).get("/contracts").set("x-api-key", apiKey);
    expect(listResponse.body).toHaveLength(1);
  });

  it("returns 404 for an unknown contract id", async () => {
    const response = await request(getApp().getHttpServer()).get("/contracts/999999").set("x-api-key", apiKey);
    expect(response.status).toBe(404);
  });

  it("updates a contract name via PATCH /contracts/:id", async () => {
    const registerResponse = await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address: contractAddress("CONTRACT_PATCH_A"), network: "testnet", name: "Initial Name" });

    const contractId = registerResponse.body.id;

    const patchResponse = await request(getApp().getHttpServer())
      .patch(`/contracts/${contractId}`)
      .set("x-api-key", apiKey)
      .send({ name: "Updated Name" });

    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body).toMatchObject({
      id: contractId,
      address: contractAddress("CONTRACT_PATCH_A"),
      network: "testnet",
      name: "Updated Name"
    });

    const getResponse = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}`)
      .set("x-api-key", apiKey);

    expect(getResponse.body.name).toBe("Updated Name");
  });

  it("returns 404 when updating an unknown contract id", async () => {
    const response = await request(getApp().getHttpServer())
      .patch("/contracts/999999")
      .set("x-api-key", apiKey)
      .send({ name: "Updated Name" });

    expect(response.status).toBe(404);
  });

  describe("address validation", () => {
    it("rejects a malformed address with 400", async () => {
      const response = await request(getApp().getHttpServer())
        .post("/contracts")
        .set("x-api-key", apiKey)
        .send({ address: "not-an-address", network: "testnet" });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toMatch(/address/i);
    });

    it("accepts a valid contract (C...) strkey", async () => {
      const response = await request(getApp().getHttpServer())
        .post("/contracts")
        .set("x-api-key", apiKey)
        .send({ address: contractAddress("VALIDATION_ACCEPT_C"), network: "testnet" });

      expect(response.status).toBe(201);
    });
  });
});
