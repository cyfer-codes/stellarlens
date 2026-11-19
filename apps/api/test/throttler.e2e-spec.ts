import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApiKey } from "./helpers";
import { getApp, getTestDb } from "./setup";

describe("api key throttling (e2e)", () => {
  it("includes Retry-After on throttled responses only", async () => {
    const apiKey = await createApiKey(getTestDb());

    for (let i = 0; i < 100; i++) {
      const response = await request(getApp().getHttpServer()).get("/contracts").set("x-api-key", apiKey);
      expect(response.status).toBe(200);
      expect(response.headers["retry-after"]).toBeUndefined();
    }

    const throttled = await request(getApp().getHttpServer()).get("/contracts").set("x-api-key", apiKey);
    expect(throttled.status).toBe(429);
    expect(Number(throttled.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("enforces a custom per-key rate limit and allows updating it", async () => {
    const db = getTestDb();
    const customKey = await createApiKey(db, { rateLimitPerMinute: 2 });
    const defaultKey = await createApiKey(db);

    // Custom-limit key: first two requests succeed, third is throttled.
    for (let i = 0; i < 2; i++) {
      const response = await request(getApp().getHttpServer()).get("/contracts").set("x-api-key", customKey);
      expect(response.status).toBe(200);
      expect(response.headers["retry-after"]).toBeUndefined();
    }

    const throttled = await request(getApp().getHttpServer()).get("/contracts").set("x-api-key", customKey);
    expect(throttled.status).toBe(429);
    expect(Number(throttled.headers["retry-after"])).toBeGreaterThan(0);

    // Default-limit key still allows the global quota.
    for (let i = 0; i < 100; i++) {
      const response = await request(getApp().getHttpServer()).get("/contracts").set("x-api-key", defaultKey);
      expect(response.status).toBe(200);
      expect(response.headers["retry-after"]).toBeUndefined();
    }

    const defaultThrottled = await request(getApp().getHttpServer()).get("/contracts").set("x-api-key", defaultKey);
    expect(defaultThrottled.status).toBe(429);
    expect(Number(defaultThrottled.headers["retry-after"])).toBeGreaterThan(0);

    // Update the custom key's limit via the update endpoint.
    const updateResponse = await request(getApp().getHttpServer())
      .patch(`/api-keys/${customKey.id}`)
      .set("x-api-key", defaultKey)
      .send({ rateLimitPerMinute: 5 });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.rateLimitPerMinute).toBe(5);

    // The new limit is enforced: the key can now make more requests.
    for (let i = 0; i < 5; i++) {
      const response = await request(getApp().getHttpServer()).get("/contracts").set("x-api-key", customKey);
      expect(response.status).toBe(200);
      expect(response.headers["retry-after"]).toBeUndefined();
    }

    const updatedThrottled = await request(getApp().getHttpServer()).get("/contracts").set("x-api-key", customKey);
    expect(updatedThrottled.status).toBe(429);
    expect(Number(updatedThrottled.headers["retry-after"])).toBeGreaterThan(0);
  });
});