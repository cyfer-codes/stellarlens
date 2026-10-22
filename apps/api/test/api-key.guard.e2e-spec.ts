import { ForbiddenException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { apiKeys } from "@stellarlens/db";
import { describe, expect, it } from "vitest";
import { Public } from "../src/auth/decorators/public.decorator";
import { ApiKeyGuard } from "../src/auth/guards/api-key.guard";
import { createApiKey } from "./helpers";
import { getTestDb } from "./setup";

class TestController {
  protected() {}

  mutate() {}

  @Public()
  open() {}
}

function contextFor(handler: () => void, headers: Record<string, string> = {}, method = "GET") {
  const request: Record<string, unknown> = { headers, method };
  const context = {
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: () => request })
  } as unknown as ExecutionContext;
  return { context, request };
}

describe("ApiKeyGuard", () => {
  const guard = () => new ApiKeyGuard(new Reflector(), getTestDb());

  it("rejects a request with no x-api-key header", async () => {
    const { context } = contextFor(TestController.prototype.protected);
    await expect(guard().canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects an api key that doesn't match any hash", async () => {
    const { context } = contextFor(TestController.prototype.protected, { "x-api-key": "not-a-real-key" });
    await expect(guard().canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects a revoked api key", async () => {
    const db = getTestDb();
    const apiKey = await createApiKey(db);
    await db.update(apiKeys).set({ revokedAt: new Date() });

    const { context } = contextFor(TestController.prototype.protected, { "x-api-key": apiKey });
    await expect(guard().canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects an api key whose expiresAt has passed", async () => {
    const db = getTestDb();
    const apiKey = await createApiKey(db);
    await db.update(apiKeys).set({ expiresAt: new Date(Date.now() - 60_000) });

    const { context } = contextFor(TestController.prototype.protected, { "x-api-key": apiKey });
    await expect(guard().canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("accepts an api key whose expiresAt is in the future", async () => {
    const db = getTestDb();
    const apiKey = await createApiKey(db);
    await db.update(apiKeys).set({ expiresAt: new Date(Date.now() + 60_000) });

    const { context, request } = contextFor(TestController.prototype.protected, { "x-api-key": apiKey });
    await expect(guard().canActivate(context)).resolves.toBe(true);
    expect(request.apiKey).toBeDefined();
  });

  it("accepts a valid key and attaches it to the request", async () => {
    const apiKey = await createApiKey(getTestDb());
    const { context, request } = contextFor(TestController.prototype.protected, { "x-api-key": apiKey });

    await expect(guard().canActivate(context)).resolves.toBe(true);
    expect(request.apiKey).toBeDefined();
  });

  it("accepts a read-scoped key on a GET route", async () => {
    const apiKey = await createApiKey(getTestDb(), { scope: "read" });
    const { context } = contextFor(TestController.prototype.protected, { "x-api-key": apiKey }, "GET");

    await expect(guard().canActivate(context)).resolves.toBe(true);
  });

  it("rejects a read-scoped key on a mutating route", async () => {
    const apiKey = await createApiKey(getTestDb(), { scope: "read" });
    const { context } = contextFor(TestController.prototype.mutate, { "x-api-key": apiKey }, "POST");

    await expect(guard().canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("skips the check entirely for a @Public() route", async () => {
    const { context, request } = contextFor(TestController.prototype.open);

    await expect(guard().canActivate(context)).resolves.toBe(true);
    expect(request.apiKey).toBeUndefined();
  });

  it("updates lastUsedAt on successful authentication", async () => {
    const db = getTestDb();
    const apiKey = await createApiKey(db);
    const { context } = contextFor(TestController.prototype.protected, { "x-api-key": apiKey });

    await expect(guard().canActivate(context)).resolves.toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 50));
    const [row] = await db.select().from(apiKeys);
    expect(row.lastUsedAt).toBeInstanceOf(Date);
  });
});
