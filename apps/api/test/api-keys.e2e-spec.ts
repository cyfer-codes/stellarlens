import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiKey } from "./helpers";
import { getApp, getTestDb } from "./setup";

describe("api keys (e2e)", () => {
  let apiKey: string;

  beforeEach(async () => {
    apiKey = await createApiKey(getTestDb());
  });

  it("generates a new api key, returning the raw key once", async () => {
    const response = await request(getApp().getHttpServer())
      .post("/api-keys")
      .set("x-api-key", apiKey)
      .send({ name: "ci-bot" });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ name: "ci-bot" });
    expect(response.body.id).toBeDefined();
    expect(typeof response.body.key).toBe("string");
    expect(response.body.key.length).toBeGreaterThan(10);
  });

  it("lists api keys without exposing the key hash or raw key", async () => {
    await request(getApp().getHttpServer()).post("/api-keys").set("x-api-key", apiKey).send({ name: "listed-key" });

    const response = await request(getApp().getHttpServer()).get("/api-keys").set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    const names = response.body.map((row: { name: string | null }) => row.name);
    expect(names).toContain("listed-key");
    for (const row of response.body) {
      expect(row.keyHash).toBeUndefined();
      expect(row.key).toBeUndefined();
      expect(row).toHaveProperty("expiresAt");
      expect(row.expiresAt === null || typeof row.expiresAt === "string").toBe(true);
    }
  });

  it("returns expiresAt in the list, round-tripping the value given at creation", async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const createResponse = await request(getApp().getHttpServer())
      .post("/api-keys")
      .set("x-api-key", apiKey)
      .send({ name: "expiring-key", expiresAt: futureExpiry });
    expect(createResponse.status).toBe(201);
    const { id } = createResponse.body;

    const listResponse = await request(getApp().getHttpServer()).get("/api-keys").set("x-api-key", apiKey);
    expect(listResponse.status).toBe(200);
    const row = listResponse.body.find((entry: { id: number }) => entry.id === id);
    expect(row).toBeDefined();
    expect(row).toHaveProperty("expiresAt");
    expect(row.expiresAt).not.toBeNull();
    expect(new Date(row.expiresAt).toISOString()).toBe(futureExpiry);
  });

  it("records lastUsedAt after a key successfully authenticates", async () => {
    const createResponse = await request(getApp().getHttpServer())
      .post("/api-keys")
      .set("x-api-key", apiKey)
      .send({ name: "tracked-key" });
    const { id, key: trackedRawKey } = createResponse.body;

    const findTracked = async () => {
      const response = await request(getApp().getHttpServer())
        .get("/api-keys")
        .set("x-api-key", apiKey);
      return response.body.find((row: { id: number }) => row.id === id);
    };

    expect((await findTracked()).lastUsedAt).toBeNull();

    await request(getApp().getHttpServer()).get("/contracts").set("x-api-key", trackedRawKey);

    // the guard writes lastUsedAt fire-and-forget, so poll briefly rather than assert immediately
    await vi.waitFor(async () => {
      expect((await findTracked()).lastUsedAt).not.toBeNull();
    });
  });

  it("revokes a key, after which it can no longer authenticate", async () => {
    const createResponse = await request(getApp().getHttpServer())
      .post("/api-keys")
      .set("x-api-key", apiKey)
      .send({});
    const { id, key: revokedRawKey } = createResponse.body;

    const revokeResponse = await request(getApp().getHttpServer())
      .delete(`/api-keys/${id}`)
      .set("x-api-key", apiKey);
    expect(revokeResponse.status).toBe(204);

    const useRevokedKey = await request(getApp().getHttpServer()).get("/contracts").set("x-api-key", revokedRawKey);
    expect(useRevokedKey.status).toBe(401);
  });

  it("is idempotent when revoking an already-revoked key", async () => {
    const createResponse = await request(getApp().getHttpServer())
      .post("/api-keys")
      .set("x-api-key", apiKey)
      .send({});
    const { id } = createResponse.body;

    await request(getApp().getHttpServer()).delete(`/api-keys/${id}`).set("x-api-key", apiKey);
    const secondRevoke = await request(getApp().getHttpServer()).delete(`/api-keys/${id}`).set("x-api-key", apiKey);
    expect(secondRevoke.status).toBe(204);
  });

  it("returns 404 revoking an unknown key id", async () => {
    const response = await request(getApp().getHttpServer()).delete("/api-keys/999999").set("x-api-key", apiKey);
    expect(response.status).toBe(404);
  });

  it("rotates a key, keeping both keys valid during the overlap window", async () => {
    const createResponse = await request(getApp().getHttpServer())
      .post("/api-keys")
      .set("x-api-key", apiKey)
      .send({ name: "rotating-key" });
    expect(createResponse.status).toBe(201);
    const { id, key: oldRawKey, scope: oldScope } = createResponse.body;

    const rotateResponse = await request(getApp().getHttpServer())
      .post(`/api-keys/${id}/rotate`)
      .set("x-api-key", apiKey)
      .send({});
    expect([200, 201]).toContain(rotateResponse.status);
    expect(rotateResponse.body.name).toBe("rotating-key");
    expect(rotateResponse.body.scope).toBe(oldScope);
    expect(rotateResponse.body.id).toBeDefined();
    expect(rotateResponse.body.id).not.toBe(id);
    expect(typeof rotateResponse.body.key).toBe("string");
    expect(rotateResponse.body.key.length).toBeGreaterThan(10);
    expect(rotateResponse.body.key).not.toBe(oldRawKey);
    const newRawKey = rotateResponse.body.key;

    const useOldKey = await request(getApp().getHttpServer()).get("/contracts").set("x-api-key", oldRawKey);
    expect(useOldKey.status).toBe(200);

    const useNewKey = await request(getApp().getHttpServer()).get("/contracts").set("x-api-key", newRawKey);
    expect(useNewKey.status).toBe(200);
  });

  it("rejects the old key after the rotation grace period elapses", async () => {
    const createResponse = await request(getApp().getHttpServer())
      .post("/api-keys")
      .set("x-api-key", apiKey)
      .send({ name: "short-grace-key" });
    expect(createResponse.status).toBe(201);
    const { id, key: oldRawKey } = createResponse.body;

    const rotateResponse = await request(getApp().getHttpServer())
      .post(`/api-keys/${id}/rotate`)
      .set("x-api-key", apiKey)
      .send({ gracePeriodMs: 50 });
    expect([200, 201]).toContain(rotateResponse.status);
    const newRawKey = rotateResponse.body.key;

    const useNewKey = await request(getApp().getHttpServer()).get("/contracts").set("x-api-key", newRawKey);
    expect(useNewKey.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const useOldKey = await request(getApp().getHttpServer()).get("/contracts").set("x-api-key", oldRawKey);
    expect(useOldKey.status).toBe(401);

    const useNewKeyAgain = await request(getApp().getHttpServer()).get("/contracts").set("x-api-key", newRawKey);
    expect(useNewKeyAgain.status).toBe(200);
  });

  it("returns 403 rotating a key with a read-scope key", async () => {
    const createResponse = await request(getApp().getHttpServer())
      .post("/api-keys")
      .set("x-api-key", apiKey)
      .send({ name: "target-key" });
    expect(createResponse.status).toBe(201);
    const { id } = createResponse.body;

    const readKeyResponse = await request(getApp().getHttpServer())
      .post("/api-keys")
      .set("x-api-key", apiKey)
      .send({ name: "read-only-key", scope: "read" });
    expect(readKeyResponse.status).toBe(201);
    const readRawKey = readKeyResponse.body.key;

    const rotateResponse = await request(getApp().getHttpServer())
      .post(`/api-keys/${id}/rotate`)
      .set("x-api-key", readRawKey)
      .send({});
    expect(rotateResponse.status).toBe(403);
  });

  it("returns 404 rotating an unknown key id", async () => {
    const response = await request(getApp().getHttpServer())
      .post("/api-keys/999999/rotate")
      .set("x-api-key", apiKey)
      .send({});
    expect(response.status).toBe(404);
  });

  it("rejects an expired key and accepts a key that has not yet expired", async () => {
    const pastExpiry = new Date(Date.now() - 60_000).toISOString();
    const expiredCreate = await request(getApp().getHttpServer())
      .post("/api-keys")
      .set("x-api-key", apiKey)
      .send({ name: "expired-key", expiresAt: pastExpiry });
    expect(expiredCreate.status).toBe(201);
    expect(expiredCreate.body.expiresAt).toBeDefined();
    expect(new Date(expiredCreate.body.expiresAt).toISOString()).toBe(pastExpiry);

    const useExpiredKey = await request(getApp().getHttpServer())
      .get("/contracts")
      .set("x-api-key", expiredCreate.body.key);
    expect(useExpiredKey.status).toBe(401);

    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const validCreate = await request(getApp().getHttpServer())
      .post("/api-keys")
      .set("x-api-key", apiKey)
      .send({ name: "valid-key", expiresAt: futureExpiry });
    expect(validCreate.status).toBe(201);
    expect(validCreate.body.expiresAt).toBeDefined();
    expect(new Date(validCreate.body.expiresAt).toISOString()).toBe(futureExpiry);

    const useValidKey = await request(getApp().getHttpServer())
      .get("/contracts")
      .set("x-api-key", validCreate.body.key);
    expect(useValidKey.status).toBe(200);
  });
});
