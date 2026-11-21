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
    }
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
});
