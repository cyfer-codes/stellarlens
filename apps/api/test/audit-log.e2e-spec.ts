import { createHash } from "node:crypto";
import request from "supertest";
import { eq } from "drizzle-orm";
import { apiKeys } from "@stellarlens/db";
import { beforeEach, describe, expect, it } from "vitest";
import { contractAddress, createApiKey } from "./helpers";
import { getApp, getTestDb } from "./setup";

interface AuditEntry {
  id: number;
  apiKeyId: number | null;
  action: string;
  resource: string;
  resourceId: string | null;
  diff: Record<string, unknown> | null;
  createdAt: string;
}

async function apiKeyId(rawKey: string): Promise<number> {
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const [row] = await getTestDb().select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.keyHash, keyHash));
  return row.id;
}

describe("audit log (e2e)", () => {
  let apiKey: string;
  let keyId: number;

  beforeEach(async () => {
    apiKey = await createApiKey(getTestDb());
    keyId = await apiKeyId(apiKey);
  });

  it("records which key registered and renamed a contract, and ignores reads", async () => {
    const created = await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({
        address: contractAddress("AUDIT_CONTRACT"),
        network: "testnet",
        name: "Original"
      });
    expect(created.status).toBe(201);
    const contractId = created.body.id as number;

    const renamed = await request(getApp().getHttpServer())
      .patch(`/contracts/${contractId}`)
      .set("x-api-key", apiKey)
      .send({ name: "Renamed" });
    expect(renamed.status).toBe(200);

    const read = await request(getApp().getHttpServer()).get(`/contracts/${contractId}`).set("x-api-key", apiKey);
    expect(read.status).toBe(200);

    const log = await request(getApp().getHttpServer()).get("/audit-log").set("x-api-key", apiKey);
    expect(log.status).toBe(200);
    expect(log.body.nextCursor).toBeNull();
    expect(log.body.data).toHaveLength(2);

    const [update, create] = log.body.data as AuditEntry[];
    expect(update).toMatchObject({
      apiKeyId: keyId,
      action: "update",
      resource: "contract",
      resourceId: String(contractId),
      diff: { name: "Renamed" }
    });
    expect(update.createdAt).toEqual(expect.any(String));
    expect(create).toMatchObject({
      apiKeyId: keyId,
      action: "create",
      resource: "contract",
      resourceId: String(contractId)
    });
    expect(create.diff).toMatchObject({
      address: contractAddress("AUDIT_CONTRACT"),
      network: "testnet",
      name: "Original"
    });
  });

  it("records webhook create, secret rotation, and delete without storing the secret", async () => {
    const created = await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address: contractAddress("AUDIT_WEBHOOK"), network: "testnet" });
    const contractId = created.body.id as number;

    const webhook = await request(getApp().getHttpServer())
      .post(`/contracts/${contractId}/webhooks`)
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com/audit-hook" });
    expect(webhook.status).toBe(201);
    const webhookId = webhook.body.id as number;
    const createdSecret = webhook.body.secret as string;

    const rotated = await request(getApp().getHttpServer())
      .post(`/contracts/${contractId}/webhooks/${webhookId}/rotate-secret`)
      .set("x-api-key", apiKey);
    expect(rotated.status).toBe(201);
    const rotatedSecret = rotated.body.secret as string;

    const removed = await request(getApp().getHttpServer())
      .delete(`/contracts/${contractId}/webhooks/${webhookId}`)
      .set("x-api-key", apiKey);
    expect(removed.status).toBe(204);

    const log = await request(getApp().getHttpServer()).get("/audit-log?limit=100").set("x-api-key", apiKey);
    expect(log.status).toBe(200);

    const webhookEntries = (log.body.data as AuditEntry[]).filter((entry) => entry.resource === "webhook");
    expect(webhookEntries.map((entry) => entry.action)).toEqual(["delete", "rotate-secret", "create"]);
    expect(webhookEntries.every((entry) => entry.apiKeyId === keyId && entry.resourceId === String(webhookId))).toBe(
      true
    );
    expect(webhookEntries[2].diff).toMatchObject({ url: "https://example.com/audit-hook" });
    expect(webhookEntries[0].diff).toBeNull();

    const serialized = JSON.stringify(log.body);
    expect(serialized).not.toContain(createdSecret);
    expect(serialized).not.toContain(rotatedSecret);
  });

  it("attributes each mutation to the key that performed it", async () => {
    const otherKey = await createApiKey(getTestDb());
    const otherKeyId = await apiKeyId(otherKey);

    await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", apiKey)
      .send({ address: contractAddress("AUDIT_KEY_A"), network: "testnet" });
    await request(getApp().getHttpServer())
      .post("/contracts")
      .set("x-api-key", otherKey)
      .send({ address: contractAddress("AUDIT_KEY_B"), network: "testnet" });

    const log = await request(getApp().getHttpServer()).get("/audit-log").set("x-api-key", apiKey);
    const ids = (log.body.data as AuditEntry[]).map((entry) => entry.apiKeyId);
    expect(ids).toEqual([otherKeyId, keyId]);
  });

  it("pages the audit log newest-first with a cursor", async () => {
    for (const label of ["AUDIT_PAGE_A", "AUDIT_PAGE_B", "AUDIT_PAGE_C"]) {
      const response = await request(getApp().getHttpServer())
        .post("/contracts")
        .set("x-api-key", apiKey)
        .send({ address: contractAddress(label), network: "testnet" });
      expect(response.status).toBe(201);
    }

    const firstPage = await request(getApp().getHttpServer()).get("/audit-log?limit=2").set("x-api-key", apiKey);
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.nextCursor).toBe(firstPage.body.data[1].id);

    const secondPage = await request(getApp().getHttpServer())
      .get(`/audit-log?limit=2&cursor=${firstPage.body.nextCursor}`)
      .set("x-api-key", apiKey);
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.data).toHaveLength(1);
    expect(secondPage.body.nextCursor).toBeNull();

    const ids = [...firstPage.body.data, ...secondPage.body.data].map((entry: AuditEntry) => entry.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual([...ids].sort((left, right) => right - left));
  });

  it("allows the audit log only for full-scope keys", async () => {
    const readKey = await createApiKey(getTestDb(), { scope: "read" });

    const missing = await request(getApp().getHttpServer()).get("/audit-log");
    expect(missing.status).toBe(401);

    const forbidden = await request(getApp().getHttpServer()).get("/audit-log").set("x-api-key", readKey);
    expect(forbidden.status).toBe(403);

    const allowed = await request(getApp().getHttpServer()).get("/audit-log").set("x-api-key", apiKey);
    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({ data: [], nextCursor: null });
  });
});
