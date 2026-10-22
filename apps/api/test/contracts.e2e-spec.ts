import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApiKey } from "./helpers";
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
      .send({ address: "CONTRACT_REGISTER_A", network: "testnet", name: "My Contract" });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      address: "CONTRACT_REGISTER_A",
      network: "testnet",
      name: "My Contract"
    });
    expect(response.body.id).toBeDefined();
  });

  it("persists the registered contract, retrievable by id", async () => {
    const registerResponse = await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address: "CONTRACT_REGISTER_B", network: "testnet" });

    const contractId = registerResponse.body.id;

    const getResponse = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}`)
      .set("x-api-key", apiKey);

    expect(getResponse.status).toBe(200);
    expect(getResponse.body).toMatchObject({ id: contractId, address: "CONTRACT_REGISTER_B" });
  });

  it("upserts on re-registering the same address", async () => {
    await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address: "CONTRACT_REGISTER_C", network: "testnet", name: "Original" });

    const updateResponse = await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address: "CONTRACT_REGISTER_C", network: "testnet", name: "Renamed" });

    expect(updateResponse.status).toBe(201);
    expect(updateResponse.body.name).toBe("Renamed");

    const listResponse = await request(getApp().getHttpServer()).get("/contracts").set("x-api-key", apiKey);
    expect(listResponse.body.data).toHaveLength(1);
  });

  it("filters contracts by a partial case-insensitive name", async () => {
    await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address: "CONTRACT_NAME_A", network: "testnet", name: "Stellar Token" });
    await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address: "CONTRACT_NAME_B", network: "testnet", name: "Other Asset" });

    const response = await request(getApp().getHttpServer()).get("/contracts?name=TELLA").set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].name).toBe("Stellar Token");
  });

  it("filters contracts by network and returns all networks when omitted", async () => {
    await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address: "CONTRACT_NETWORK_A", network: "testnet" });
    await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address: "CONTRACT_NETWORK_B", network: "mainnet" });

    const filteredResponse = await request(getApp().getHttpServer())
      .get("/contracts?network=testnet")
      .set("x-api-key", apiKey);
    const allResponse = await request(getApp().getHttpServer()).get("/contracts").set("x-api-key", apiKey);

    expect(filteredResponse.body.data).toHaveLength(1);
    expect(filteredResponse.body.data[0].network).toBe("testnet");
    expect(allResponse.body.data).toHaveLength(2);
  });

  it("paginates contracts across multiple pages", async () => {
    for (const address of ["CONTRACT_PAGE_A", "CONTRACT_PAGE_B", "CONTRACT_PAGE_C"]) {
      await request(getApp().getHttpServer())
        .post("/contracts")
        .set("x-api-key", apiKey)
        .send({ address, network: "testnet" });
    }

    const firstPage = await request(getApp().getHttpServer()).get("/contracts?limit=2").set("x-api-key", apiKey);
    const secondPage = await request(getApp().getHttpServer())
      .get(`/contracts?limit=2&cursor=${firstPage.body.nextCursor}`)
      .set("x-api-key", apiKey);

    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.nextCursor).toBe(firstPage.body.data[1].id);
    expect(secondPage.body.data).toHaveLength(1);
    expect(secondPage.body.nextCursor).toBeNull();
  });

  it("returns 404 for an unknown contract id", async () => {
    const response = await request(getApp().getHttpServer()).get("/contracts/999999").set("x-api-key", apiKey);
    expect(response.status).toBe(404);
  });

  it("updates a contract name via PATCH /contracts/:id", async () => {
    const registerResponse = await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address: "CONTRACT_PATCH_A", network: "testnet", name: "Initial Name" });

    const contractId = registerResponse.body.id;

    const patchResponse = await request(getApp().getHttpServer())
      .patch(`/contracts/${contractId}`)
      .set("x-api-key", apiKey)
      .send({ name: "Updated Name" });

    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body).toMatchObject({
      id: contractId,
      address: "CONTRACT_PATCH_A",
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
});
