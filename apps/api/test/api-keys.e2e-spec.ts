import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
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
      expect("lastUsedAt" in row).toBe(true);
    }
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
