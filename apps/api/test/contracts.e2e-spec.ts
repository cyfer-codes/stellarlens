import request from "supertest";
import { indexerCheckpoints } from "@stellarlens/db";
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
      .send({
        address: contractAddress("CONTRACT_REGISTER_A"),
        network: "testnet",
        name: "My Contract"
      });

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
    expect(getResponse.body).toMatchObject({
      id: contractId,
      address: contractAddress("CONTRACT_REGISTER_B")
    });
  });

  it("returns 409 with the existing id and preserves data when re-registering an address", async () => {
    const address = contractAddress("CONTRACT_REGISTER_C");
    const created = await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address, network: "testnet", name: "Original" });

    expect(created.status).toBe(201);

    const duplicate = await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address, network: "mainnet", name: "Renamed" });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.existingId).toBe(created.body.id);

    const stored = await request(getApp().getHttpServer())
      .get(`/contracts/${created.body.id}`)
      .set("x-api-key", apiKey);

    expect(stored.status).toBe(200);
    expect(stored.body).toMatchObject({
      id: created.body.id,
      address,
      network: "testnet",
      name: "Original"
    });

    const listResponse = await request(getApp().getHttpServer())
      .get("/contracts")
      .set("x-api-key", apiKey);
    expect(listResponse.body.data).toHaveLength(1);
  });

  it("filters contracts by a partial case-insensitive name", async () => {
    await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({
        address: contractAddress("CONTRACT_NAME_A"),
        network: "testnet",
        name: "Stellar Token"
      });
    await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({
        address: contractAddress("CONTRACT_NAME_B"),
        network: "testnet",
        name: "Other Asset"
      });

    const response = await request(getApp().getHttpServer())
      .get("/contracts?name=TELLA")
      .set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].name).toBe("Stellar Token");
  });

  it("filters contracts by network and returns all networks when omitted", async () => {
    await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address: contractAddress("CONTRACT_NETWORK_A"), network: "testnet" });
    await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address: contractAddress("CONTRACT_NETWORK_B"), network: "mainnet" });

    const filteredResponse = await request(getApp().getHttpServer())
      .get("/contracts?network=testnet")
      .set("x-api-key", apiKey);
    const allResponse = await request(getApp().getHttpServer())
      .get("/contracts")
      .set("x-api-key", apiKey);

    expect(filteredResponse.body.data).toHaveLength(1);
    expect(filteredResponse.body.data[0].network).toBe("testnet");
    expect(allResponse.body.data).toHaveLength(2);
  });

  it("paginates contracts across multiple pages", async () => {
    for (const address of ["CONTRACT_PAGE_A", "CONTRACT_PAGE_B", "CONTRACT_PAGE_C"]) {
      await request(getApp().getHttpServer())
        .post("/contracts")
        .set("x-api-key", apiKey)
        .send({ address: contractAddress(address), network: "testnet" });
    }

    const firstPage = await request(getApp().getHttpServer())
      .get("/contracts?limit=2")
      .set("x-api-key", apiKey);
    const secondPage = await request(getApp().getHttpServer())
      .get(`/contracts?limit=2&cursor=${firstPage.body.nextCursor}`)
      .set("x-api-key", apiKey);

    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.nextCursor).toBe(firstPage.body.data[1].id);
    expect(secondPage.body.data).toHaveLength(1);
    expect(secondPage.body.nextCursor).toBeNull();
  });

  it("pages contracts newest-first with order=desc and keeps the default ascending", async () => {
    const registeredIds: number[] = [];
    for (const address of ["CONTRACT_ORDER_A", "CONTRACT_ORDER_B", "CONTRACT_ORDER_C", "CONTRACT_ORDER_D"]) {
      const response = await request(getApp().getHttpServer())
        .post("/contracts")
        .set("x-api-key", apiKey)
        .send({ address: contractAddress(address), network: "testnet" });
      registeredIds.push(response.body.id);
    }

    const defaultResponse = await request(getApp().getHttpServer())
      .get("/contracts?limit=100")
      .set("x-api-key", apiKey);
    expect(defaultResponse.body.data.map((contract: { id: number }) => contract.id)).toEqual(
      registeredIds
    );

    const ascResponse = await request(getApp().getHttpServer())
      .get("/contracts?limit=100&order=asc")
      .set("x-api-key", apiKey);
    expect(ascResponse.body.data.map((contract: { id: number }) => contract.id)).toEqual(
      registeredIds
    );

    const seenIds: number[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const query = cursor
        ? `/contracts?limit=2&order=desc&cursor=${cursor}`
        : "/contracts?limit=2&order=desc";
      const page = await request(getApp().getHttpServer())
        .get(query)
        .set("x-api-key", apiKey);

      expect(page.status).toBe(200);
      const pageIds = page.body.data.map((contract: { id: number }) => contract.id);
      expect(pageIds.length).toBeGreaterThan(0);
      for (const id of pageIds) {
        expect(seenIds).not.toContain(id);
      }
      seenIds.push(...pageIds);
      cursor = page.body.nextCursor;
      pages += 1;
      expect(pages).toBeLessThanOrEqual(registeredIds.length);
    } while (cursor);

    expect(seenIds).toEqual([...registeredIds].reverse());
  });

  it("returns 404 for an unknown contract id", async () => {
    const response = await request(getApp().getHttpServer())
      .get("/contracts/999999")
      .set("x-api-key", apiKey);
    expect(response.status).toBe(404);
  });

  it("reports whether a contract network is indexed and its ledger lag", async () => {
    const registerResponse = await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address: contractAddress("CONTRACT_STATUS_A"), network: "testnet" });
    const contractId = registerResponse.body.id;

    const notIndexed = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/status`)
      .set("x-api-key", apiKey);
    expect(notIndexed.body.status).toBe("not_indexed");

    await getTestDb().insert(indexerCheckpoints).values({
      network: "testnet",
      cursor: "status-cursor",
      latestLedger: 1000,
      updatedAt: new Date()
    });
    const live = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/status`)
      .set("x-api-key", apiKey);
    expect(live.body).toMatchObject({ status: "live", lag: 0 });
  });

  it("updates a contract name via PATCH /contracts/:id", async () => {
    const registerResponse = await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({
        address: contractAddress("CONTRACT_PATCH_A"),
        network: "testnet",
        name: "Initial Name"
      });

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

  describe("bulk registration", () => {
    it("registers a mixed batch and reports a result per item", async () => {
      const existingResponse = await request(getApp().getHttpServer())
        .post("/contracts")
        .set("x-api-key", apiKey)
        .send({
          address: contractAddress("BULK_EXISTING"),
          network: "testnet",
          name: "Already Here"
        });
      const existingId = existingResponse.body.id;

      const items = [
        { address: contractAddress("BULK_NEW_A"), network: "testnet", name: "Bulk A" },
        { address: contractAddress("BULK_EXISTING"), network: "testnet", name: "Ignored Rename" },
        { address: "not-an-address", network: "testnet", name: "Broken" },
        { address: contractAddress("BULK_NEW_B"), network: "mainnet" },
        { address: contractAddress("BULK_NEW_A"), network: "testnet", name: "Duplicate In Batch" }
      ];

      const response = await request(getApp().getHttpServer())
        .post("/contracts/bulk")
        .set("x-api-key", apiKey)
        .send({ items });

      expect(response.status).toBe(201);
      expect(response.body.results).toHaveLength(items.length);
      expect(response.body.results.map((result: { status: string }) => result.status)).toEqual([
        "created",
        "existing",
        "error",
        "created",
        "existing"
      ]);

      const [createdA, existing, invalid, createdB, duplicate] = response.body.results;
      expect(createdA).toMatchObject({
        index: 0,
        address: contractAddress("BULK_NEW_A"),
        status: "created"
      });
      expect(createdA.id).toBeDefined();
      expect(existing).toMatchObject({
        index: 1,
        id: existingId,
        address: contractAddress("BULK_EXISTING"),
        name: "Already Here",
        status: "existing"
      });
      expect(invalid.status).toBe("error");
      expect(invalid.error).toMatch(/address/i);
      expect(createdB).toMatchObject({
        index: 3,
        network: "mainnet",
        name: null,
        status: "created"
      });
      expect(duplicate).toMatchObject({ index: 4, id: createdA.id, status: "existing" });

      const listResponse = await request(getApp().getHttpServer())
        .get("/contracts?limit=100")
        .set("x-api-key", apiKey);
      expect(listResponse.body.data).toHaveLength(3);
    });

    it("rejects an empty batch with 400", async () => {
      const response = await request(getApp().getHttpServer())
        .post("/contracts/bulk")
        .set("x-api-key", apiKey)
        .send({ items: [] });

      expect(response.status).toBe(400);
    });

    it("rejects a batch of more than 100 items with 400", async () => {
      const items = Array.from({ length: 101 }, (_, index) => ({
        address: contractAddress(`BULK_TOO_MANY_${index}`),
        network: "testnet"
      }));

      const response = await request(getApp().getHttpServer())
        .post("/contracts/bulk")
        .set("x-api-key", apiKey)
        .send({ items });

      expect(response.status).toBe(400);
    });
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
