import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { nativeToScVal, rpc } from "@stellar/stellar-sdk";
import {
  contracts,
  events as eventsTable,
  webhookDeliveries,
  webhooks as webhooksTable,
  type Database
} from "@stellarlens/db";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import {
  WEBHOOK_CONCURRENCY,
  WEBHOOK_MAX_RETRIES,
  STELLAR_NETWORK as NETWORK
} from "../src/config.js";
import { processEventsBatch } from "../src/events.js";
import { registerContract } from "../src/registry.js";
import { assertPublicWebhookUrl, deliverWebhooksForEvent } from "../src/webhooks.js";
import { contractAddress } from "./addresses.js";
import { mockJsonRpc, TEST_RPC_URL } from "./rpc-mocks.js";
import { getTestDb, mswServer } from "./setup.js";

const WEBHOOK_URL = "http://8.8.8.8/webhook-endpoint";

function symbolXdr(value: string): string {
  return nativeToScVal(value, { type: "symbol" }).toXdr("base64");
}

function i128Xdr(value: bigint): string {
  return nativeToScVal(value, { type: "i128" }).toXdr("base64");
}

function makeServer(): rpc.Server {
  return new rpc.Server(TEST_RPC_URL, { allowHttp: true });
}

function buildLatestLedger(sequence: number) {
  return {
    id: "abc",
    sequence,
    protocolVersion: "21",
    closeTime: "0",
    headerXdr: "AAAAAA==",
    metadataXdr: "AAAAAA=="
  };
}

async function registerWebhook(
  contractId: number,
  secret: string,
  eventTypes?: string[],
  active = true
) {
  const db = getTestDb();
  await db
    .insert(webhooksTable)
    .values({ contractId, url: WEBHOOK_URL, secret, eventTypes: eventTypes ?? null, active });
}

describe("webhook URL IP validation", () => {
  it("rejects a URL that resolves to a private IPv4 address", async () => {
    await expect(
      assertPublicWebhookUrl("https://hooks.example.com", async () => [{ address: "10.0.0.12" }])
    ).rejects.toThrow("non-public IP address");
  });

  it("rejects a URL with an IPv6 unique-local address", async () => {
    await expect(assertPublicWebhookUrl("http://[fd12::1]/webhook")).rejects.toThrow(
      "non-public IP address"
    );
  });

  it("allows a URL that resolves to a public IP address", async () => {
    await expect(
      assertPublicWebhookUrl("https://hooks.example.com", async () => [
        { address: "93.184.216.34" }
      ])
    ).resolves.toBeUndefined();
  });
});

describe("webhook delivery", () => {
  it("fires a signed POST to every webhook registered for the indexed event's contract", async () => {
    const db = getTestDb();
    const contract = await registerContract(db, { address: contractAddress("CONTRACT_HOOK"), network: NETWORK });
    const secret = "test-secret";
    await registerWebhook(contract.id, secret);

    let receivedBody = "";
    let receivedSignature = "";
    const webhookSpy = vi.fn(async ({ request }: { request: Request }) => {
      receivedBody = await request.text();
      receivedSignature = request.headers.get("x-webhook-signature") ?? "";
      return HttpResponse.json({ ok: true });
    });

    mswServer.use(
      mockJsonRpc({
        getLatestLedger: () => buildLatestLedger(5000),
        getEvents: () => ({
          events: [
            {
              id: "0000000000000000000-0000000000",
              ledger: 5005,
              txHash: "d".repeat(64),
              contractId: contractAddress("CONTRACT_HOOK"),
              topic: [symbolXdr("fee")],
              value: i128Xdr(-100n)
            }
          ],
          cursor: "CURSOR_HOOK",
          latestLedger: 5005
        })
      }),
      http.post(WEBHOOK_URL, webhookSpy)
    );

    await processEventsBatch(db, makeServer());

    expect(webhookSpy).toHaveBeenCalledTimes(1);
    const expectedSignature = createHmac("sha256", secret).update(receivedBody).digest("hex");
    expect(receivedSignature).toBe(`sha256=${expectedSignature}`);

    const payload = JSON.parse(receivedBody) as {
      contractId: number;
      ledger: number;
      txHash: string;
    };
    expect(payload.contractId).toBe(contract.id);
    expect(payload.ledger).toBe(5005);
    expect(payload.txHash).toBe("d".repeat(64));
  });

  it("caps concurrent deliveries at the configured limit", async () => {
    const db = getTestDb();
    const contract = await registerContract(db, {
      address: contractAddress("CONTRACT_HOOK_CONCURRENCY"),
      network: NETWORK
    });
    const recipientCount = WEBHOOK_CONCURRENCY + 3;
    await db.insert(webhooksTable).values(
      Array.from({ length: recipientCount }, (_, index) => ({
        contractId: contract.id,
        url: WEBHOOK_URL,
        secret: `secret-${index}`,
        eventTypes: null
      }))
    );

    let activeDeliveries = 0;
    let maxConcurrentDeliveries = 0;
    mswServer.use(
      http.post(WEBHOOK_URL, async () => {
        activeDeliveries += 1;
        maxConcurrentDeliveries = Math.max(maxConcurrentDeliveries, activeDeliveries);
        await new Promise((resolve) => setTimeout(resolve, 20));
        activeDeliveries -= 1;
        return HttpResponse.json({ ok: true });
      })
    );

    await deliverWebhooksForEvent(db, {
      eventId: 1,
      contractId: contract.id,
      ledger: 1,
      txHash: "3".repeat(64),
      topic: ["fee"],
      value: "-1"
    });

    expect(maxConcurrentDeliveries).toBeLessThanOrEqual(WEBHOOK_CONCURRENCY);
    expect(maxConcurrentDeliveries).toBe(WEBHOOK_CONCURRENCY);
  });

  it("persists a successful delivery with its attempt count and deliveredAt", async () => {
    const db = getTestDb();
    const contract = await registerContract(db, {
      address: contractAddress("CONTRACT_HOOK_DELIVERY_SUCCESS"),
      network: NETWORK
    });
    await registerWebhook(contract.id, "success-secret");

    mswServer.use(
      mockJsonRpc({
        getLatestLedger: () => buildLatestLedger(5100),
        getEvents: () => ({
          events: [
            {
              id: "0000000000000000000-0000000000",
              ledger: 5105,
              txHash: "c".repeat(64),
              contractId: contractAddress("CONTRACT_HOOK_DELIVERY_SUCCESS"),
              topic: [symbolXdr("fee")],
              value: i128Xdr(-10n)
            }
          ],
          cursor: "CURSOR_HOOK_DELIVERY_SUCCESS",
          latestLedger: 5105
        })
      }),
      http.post(WEBHOOK_URL, () => HttpResponse.json({ ok: true }))
    );

    const { indexedCount } = await processEventsBatch(db, makeServer());
    expect(indexedCount).toBe(1);

    const [event] = await db.select().from(eventsTable);
    const [delivery] = await db.select().from(webhookDeliveries);

    expect(delivery).toBeDefined();
    expect(delivery.webhookId).toBeTypeOf("number");
    expect(delivery.eventId).toBe(event.id);
    expect(delivery.status).toBe("success");
    expect(delivery.attempts).toBe(1);
    expect(delivery.lastError).toBeNull();
    expect(delivery.deliveredAt).toBeInstanceOf(Date);
  });

  it("persists a failed delivery after retries are exhausted", { timeout: 15000 }, async () => {
    const db = getTestDb();
    const contract = await registerContract(db, {
      address: contractAddress("CONTRACT_HOOK_DELIVERY_FAILED"),
      network: NETWORK
    });
    await registerWebhook(contract.id, "failed-secret");

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const webhookSpy = vi.fn(() => new HttpResponse(null, { status: 500 }));

    mswServer.use(
      mockJsonRpc({
        getLatestLedger: () => buildLatestLedger(5200),
        getEvents: () => ({
          events: [
            {
              id: "0000000000000000000-0000000000",
              ledger: 5205,
              txHash: "1".repeat(64),
              contractId: contractAddress("CONTRACT_HOOK_DELIVERY_FAILED"),
              topic: [symbolXdr("fee")],
              value: i128Xdr(-2n)
            }
          ],
          cursor: "CURSOR_HOOK_DELIVERY_FAILED",
          latestLedger: 5205
        })
      }),
      http.post(WEBHOOK_URL, webhookSpy)
    );

    const { indexedCount } = await processEventsBatch(db, makeServer());

    expect(indexedCount).toBe(1);
    expect(webhookSpy).toHaveBeenCalledTimes(WEBHOOK_MAX_RETRIES + 1);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(contractAddress("CONTRACT_HOOK_DELIVERY_FAILED")),
      expect.any(Error)
    );
    consoleError.mockRestore();

    const [event] = await db.select().from(eventsTable);
    const [delivery] = await db.select().from(webhookDeliveries);

    expect(delivery).toBeDefined();
    expect(delivery.eventId).toBe(event.id);
    expect(delivery.status).toBe("failed");
    expect(delivery.attempts).toBe(WEBHOOK_MAX_RETRIES + 1);
    expect(delivery.lastError).toContain("status 500");
    expect(delivery.deliveredAt).toBeNull();
  });

  it("does not throw when persisting a delivery outcome fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const failingDb = {
      select: () => ({
        from: () => ({
          where: async () => [
            {
              id: 1,
              contractId: 1,
              url: WEBHOOK_URL,
              secret: "secret",
              eventTypes: null,
              createdAt: new Date()
            }
          ]
        })
      }),
      insert: () => ({
        values: async () => {
          throw new Error("database unavailable");
        }
      })
    } as unknown as Database;

    mswServer.use(http.post(WEBHOOK_URL, () => HttpResponse.json({ ok: true })));

    await expect(
      deliverWebhooksForEvent(failingDb, {
        eventId: 42,
        contractId: 1,
        contractAddress: "CONTRACT_DELIVERY_LOG",
        ledger: 1,
        txHash: "2".repeat(64),
        topic: ["fee"],
        value: "-1"
      })
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("delivery outcome could not be persisted"),
      expect.any(Error)
    );
    consoleError.mockRestore();
  });

  it("retries a failing webhook before giving up, without failing the indexing batch", async () => {
    const db = getTestDb();
    const contract = await registerContract(db, {
      address: contractAddress("CONTRACT_HOOK_RETRY"),
      network: NETWORK
    });
    await registerWebhook(contract.id, "retry-secret");

    let callCount = 0;
    const webhookSpy = vi.fn(() => {
      callCount += 1;
      if (callCount < 2) {
        return new HttpResponse(null, { status: 500 });
      }
      return HttpResponse.json({ ok: true });
    });

    mswServer.use(
      mockJsonRpc({
        getLatestLedger: () => buildLatestLedger(6000),
        getEvents: () => ({
          events: [
            {
              id: "0000000000000000000-0000000000",
              ledger: 6005,
              txHash: "e".repeat(64),
              contractId: contractAddress("CONTRACT_HOOK_RETRY"),
              topic: [symbolXdr("fee")],
              value: i128Xdr(-1n)
            }
          ],
          cursor: "CURSOR_HOOK_RETRY",
          latestLedger: 6005
        })
      }),
      http.post(WEBHOOK_URL, webhookSpy)
    );

    const { indexedCount } = await processEventsBatch(db, makeServer());

    expect(indexedCount).toBe(1);
    expect(webhookSpy).toHaveBeenCalledTimes(2);
  });

  it("skips a webhook whose eventTypes doesn't include the event's topic", async () => {
    const db = getTestDb();
    const contract = await registerContract(db, {
      address: contractAddress("CONTRACT_HOOK_FILTERED"),
      network: NETWORK
    });
    await registerWebhook(contract.id, "filtered-secret", ["mint"]);

    const webhookSpy = vi.fn(() => HttpResponse.json({ ok: true }));

    mswServer.use(
      mockJsonRpc({
        getLatestLedger: () => buildLatestLedger(8000),
        getEvents: () => ({
          events: [
            {
              id: "0000000000000000000-0000000000",
              ledger: 8005,
              txHash: "a".repeat(64),
              contractId: contractAddress("CONTRACT_HOOK_FILTERED"),
              topic: [symbolXdr("fee")],
              value: i128Xdr(-1n)
            }
          ],
          cursor: "CURSOR_HOOK_FILTERED",
          latestLedger: 8005
        })
      }),
      http.post(WEBHOOK_URL, webhookSpy)
    );

    await processEventsBatch(db, makeServer());

    expect(webhookSpy).not.toHaveBeenCalled();
  });

  it("skips an inactive webhook", async () => {
    const db = getTestDb();
    const contract = await registerContract(db, {
      address: contractAddress("CONTRACT_HOOK_INACTIVE"),
      network: NETWORK
    });
    await registerWebhook(contract.id, "inactive-secret", undefined, false);

    const webhookSpy = vi.fn(() => HttpResponse.json({ ok: true }));

    mswServer.use(
      mockJsonRpc({
        getLatestLedger: () => buildLatestLedger(8200),
        getEvents: () => ({
          events: [
            {
              id: "0000000000000000000-0000000000",
              ledger: 8205,
              txHash: "c".repeat(64),
              contractId: contractAddress("CONTRACT_HOOK_INACTIVE"),
              topic: [symbolXdr("fee")],
              value: i128Xdr(-1n)
            }
          ],
          cursor: "CURSOR_HOOK_INACTIVE",
          latestLedger: 8205
        })
      }),
      http.post(WEBHOOK_URL, webhookSpy)
    );

    await processEventsBatch(db, makeServer());

    expect(webhookSpy).not.toHaveBeenCalled();
    const deliveryRows = await db.select().from(webhookDeliveries);
    expect(deliveryRows).toHaveLength(0);
  });

  it("fires a webhook whose eventTypes includes the event's topic", async () => {
    const db = getTestDb();
    const contract = await registerContract(db, {
      address: contractAddress("CONTRACT_HOOK_MATCHED"),
      network: NETWORK
    });
    await registerWebhook(contract.id, "matched-secret", ["fee", "mint"]);

    const webhookSpy = vi.fn(() => HttpResponse.json({ ok: true }));

    mswServer.use(
      mockJsonRpc({
        getLatestLedger: () => buildLatestLedger(8500),
        getEvents: () => ({
          events: [
            {
              id: "0000000000000000000-0000000000",
              ledger: 8505,
              txHash: "b".repeat(64),
              contractId: contractAddress("CONTRACT_HOOK_MATCHED"),
              topic: [symbolXdr("fee")],
              value: i128Xdr(-1n)
            }
          ],
          cursor: "CURSOR_HOOK_MATCHED",
          latestLedger: 8505
        })
      }),
      http.post(WEBHOOK_URL, webhookSpy)
    );

    await processEventsBatch(db, makeServer());

    expect(webhookSpy).toHaveBeenCalledTimes(1);
  });

  it("does not throw when a webhook contract has no registered endpoints", async () => {
    const db = getTestDb();
    await registerContract(db, { address: contractAddress("CONTRACT_NO_HOOK"), network: NETWORK });

    mswServer.use(
      mockJsonRpc({
        getLatestLedger: () => buildLatestLedger(7000),
        getEvents: () => ({
          events: [
            {
              id: "0000000000000000000-0000000000",
              ledger: 7005,
              txHash: "f".repeat(64),
              contractId: contractAddress("CONTRACT_NO_HOOK"),
              topic: [symbolXdr("fee")],
              value: i128Xdr(-1n)
            }
          ],
          cursor: "CURSOR_NO_HOOK",
          latestLedger: 7005
        })
      })
    );

    const { indexedCount } = await processEventsBatch(db, makeServer());
    expect(indexedCount).toBe(1);

    const [row] = await db
      .select()
      .from(contracts)
      .where(eq(contracts.address, contractAddress("CONTRACT_NO_HOOK")));
    expect(row).toBeDefined();
  });
});
