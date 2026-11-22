import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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
import {
  assertPublicWebhookUrl,
  createWebhookAgent,
  deliverWebhooksForEvent,
  ipIsPublic
} from "../src/webhooks.js";
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

// One or more addresses from every IANA IPv4/IPv6 special-purpose block that is not
// globally reachable, plus boundary checks just outside each private range.
const NON_PUBLIC_ADDRESSES: Array<[string, string]> = [
  ["0.0.0.0", "this network 0.0.0.0/8"],
  ["0.255.255.255", "this network 0.0.0.0/8"],
  ["10.0.0.1", "private 10.0.0.0/8"],
  ["10.255.255.255", "private 10.0.0.0/8"],
  ["100.64.0.1", "shared address space 100.64.0.0/10"],
  ["100.127.255.254", "shared address space 100.64.0.0/10"],
  ["127.0.0.1", "loopback 127.0.0.0/8"],
  ["169.254.169.254", "link-local 169.254.0.0/16"],
  ["172.16.0.1", "private 172.16.0.0/12"],
  ["172.31.255.255", "private 172.16.0.0/12"],
  ["192.0.0.1", "IETF protocol assignments 192.0.0.0/24"],
  ["192.0.0.9", "IETF protocol assignments 192.0.0.0/24"],
  ["192.0.2.1", "documentation 192.0.2.0/24"],
  ["192.88.99.1", "6to4 relay anycast 192.88.99.0/24"],
  ["192.168.1.1", "private 192.168.0.0/16"],
  ["198.18.0.1", "benchmarking 198.18.0.0/15"],
  ["198.19.255.255", "benchmarking 198.18.0.0/15"],
  ["198.51.100.1", "documentation 198.51.100.0/24"],
  ["203.0.113.1", "documentation 203.0.113.0/24"],
  ["224.0.0.1", "multicast 224.0.0.0/4"],
  ["239.255.255.255", "multicast 224.0.0.0/4"],
  ["240.0.0.1", "reserved 240.0.0.0/4"],
  ["255.255.255.255", "limited broadcast"],
  ["::", "unspecified ::/128"],
  ["::1", "loopback ::1/128"],
  ["::10.0.0.1", "IPv4-compatible ::/96"],
  ["::ffff:10.0.0.1", "IPv4-mapped private"],
  ["::ffff:127.0.0.1", "IPv4-mapped loopback"],
  ["::ffff:169.254.169.254", "IPv4-mapped link-local"],
  ["64:ff9b::a00:1", "NAT64 64:ff9b::/96"],
  ["64:ff9b::1.1.1.1", "NAT64 64:ff9b::/96"],
  ["64:ff9b:1::1", "local-use NAT64 64:ff9b:1::/48"],
  ["100::1", "discard-only 100::/64"],
  ["2001::1", "Teredo 2001::/32"],
  ["2001:0:4136:e378:8000:63bf:3fff:fdd2", "Teredo 2001::/32"],
  ["2001:1::1", "IETF protocol assignments 2001::/23"],
  ["2001:2::1", "benchmarking 2001:2::/48"],
  ["2001:3::1", "AMT 2001:3::/32"],
  ["2001:4:112::1", "AS112-v6 2001:4:112::/48"],
  ["2001:10::1", "deprecated ORCHID 2001:10::/28"],
  ["2001:20::1", "ORCHIDv2 2001:20::/28"],
  ["2001:2f:ffff::1", "ORCHIDv2 2001:20::/28"],
  ["2001:1ff:ffff::1", "IETF protocol assignments 2001::/23"],
  ["2001:db8::1", "documentation 2001:db8::/32"],
  ["2002:a00:1::1", "6to4 2002::/16"],
  ["2002:c000:204::1", "6to4 2002::/16"],
  ["3fff::1", "documentation 3fff::/20"],
  ["3fff:fff:ffff::1", "documentation 3fff::/20"],
  ["5f00::1", "SRv6 SIDs 5f00::/16"],
  ["fc00::1", "unique-local fc00::/7"],
  ["fd12::1", "unique-local fc00::/7"],
  ["fe80::1", "link-local fe80::/10"],
  ["fe80::1%eth0", "link-local with zone id"],
  ["ff02::1", "multicast ff00::/8"]
];

const PUBLIC_ADDRESSES = [
  "1.1.1.1",
  "8.8.8.8",
  "93.184.216.34",
  "100.63.255.255",
  "100.128.0.1",
  "172.15.255.255",
  "172.32.0.1",
  "192.169.0.1",
  "198.17.255.255",
  "198.20.0.1",
  "223.255.255.255",
  "::ffff:1.1.1.1",
  "2606:4700::1111",
  "2001:4860:4860::8888",
  "2001:200::1",
  "2a00:1450:4001::1",
  "2400:cb00::1",
  "3fff:1000::1"
];

const MALFORMED_ADDRESSES = [
  "",
  "not-an-ip",
  "256.1.1.1",
  "1.2.3",
  "01.2.3.4",
  "::ffff:999.1.1.1",
  "1:2:3:4:5:6:7:8:9",
  "[::1]",
  "2001:db8::g",
  "1.1.1.1/32",
  " 1.1.1.1"
];

describe("webhook DNS rebinding protection", () => {
  it("never connects to a private address returned after the public-IP check", async () => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits += 1;
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    // First answer is public (passes the check), every later answer rebinds to loopback.
    let calls = 0;
    const resolver = vi.fn(async () =>
      calls++ === 0 ? [{ address: "93.184.216.34" }] : [{ address: "127.0.0.1" }]
    );
    const url = `http://rebind.example:${port}/webhook`;
    const agent = createWebhookAgent(resolver);

    try {
      await expect(assertPublicWebhookUrl(url, resolver)).resolves.toBeUndefined();
      await expect(
        agent.request({ origin: `http://rebind.example:${port}`, path: "/webhook", method: "POST", body: "{}" })
      ).rejects.toThrow("non-public IP address");

      expect(resolver).toHaveBeenCalledTimes(2);
      expect(hits).toBe(0);
    } finally {
      await agent.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("ipIsPublic", () => {
  it.each(NON_PUBLIC_ADDRESSES)("rejects %s (%s)", (address) => {
    expect(ipIsPublic(address)).toBe(false);
  });

  it.each(PUBLIC_ADDRESSES)("accepts public address %s", (address) => {
    expect(ipIsPublic(address)).toBe(true);
  });

  it.each(MALFORMED_ADDRESSES)("returns false without throwing for malformed input %j", (address) => {
    expect(() => ipIsPublic(address)).not.toThrow();
    expect(ipIsPublic(address)).toBe(false);
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
      contractAddress: contractAddress("CONTRACT_HOOK_CONCURRENCY"),
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

  it("records a private destination as failed without retrying or posting to it", async () => {
    const db = getTestDb();
    const contract = await registerContract(db, {
      address: contractAddress("CONTRACT_HOOK_PRIVATE"),
      network: NETWORK
    });
    const privateUrl = "http://10.0.0.5/webhook";
    await db
      .insert(webhooksTable)
      .values({ contractId: contract.id, url: privateUrl, secret: "private-secret", eventTypes: null });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const webhookSpy = vi.fn(() => HttpResponse.json({ ok: true }));
    mswServer.use(http.post(privateUrl, webhookSpy));
    const [event] = await db
      .insert(eventsTable)
      .values({ contractId: contract.id, ledger: 1, txHash: "4".repeat(64), topic: "[]" })
      .returning({ id: eventsTable.id });

    await deliverWebhooksForEvent(db, {
      eventId: event.id,
      contractId: contract.id,
      contractAddress: contractAddress("CONTRACT_HOOK_PRIVATE"),
      ledger: 1,
      txHash: "4".repeat(64),
      topic: ["fee"],
      value: "-1"
    });
    consoleError.mockRestore();

    expect(webhookSpy).not.toHaveBeenCalled();
    const [delivery] = await db.select().from(webhookDeliveries);
    expect(delivery.status).toBe("failed");
    expect(delivery.attempts).toBe(1);
    expect(delivery.lastError).toContain("non-public IP address");
  });

  it("records a redirect as failed without following it to an internal address", async () => {
    const db = getTestDb();
    const contract = await registerContract(db, {
      address: contractAddress("CONTRACT_HOOK_REDIRECT"),
      network: NETWORK
    });
    await registerWebhook(contract.id, "redirect-secret");
    const internalUrl = "http://169.254.169.254/latest/meta-data";

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const webhookSpy = vi.fn(
      () => new HttpResponse(null, { status: 302, headers: { Location: internalUrl } })
    );
    const internalSpy = vi.fn(() => HttpResponse.json({ ok: true }));
    mswServer.use(http.post(WEBHOOK_URL, webhookSpy), http.all(internalUrl, internalSpy));
    const [event] = await db
      .insert(eventsTable)
      .values({ contractId: contract.id, ledger: 1, txHash: "7".repeat(64), topic: "[]" })
      .returning({ id: eventsTable.id });

    await deliverWebhooksForEvent(db, {
      eventId: event.id,
      contractId: contract.id,
      contractAddress: contractAddress("CONTRACT_HOOK_REDIRECT"),
      ledger: 1,
      txHash: "7".repeat(64),
      topic: ["fee"],
      value: "-1"
    });
    consoleError.mockRestore();

    expect(webhookSpy).toHaveBeenCalledTimes(1);
    expect(internalSpy).not.toHaveBeenCalled();
    const [delivery] = await db.select().from(webhookDeliveries);
    expect(delivery.status).toBe("failed");
    expect(delivery.attempts).toBe(1);
    expect(delivery.lastError).toContain("redirect status 302");
    expect(delivery.lastError).toContain("redirects are not followed");
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

  it("sends a stable X-Webhook-Id with event and attempt headers across retries", async () => {
    const db = getTestDb();
    const contract = await registerContract(db, {
      address: contractAddress("CONTRACT_HOOK_IDEMPOTENCY"),
      network: NETWORK
    });
    await registerWebhook(contract.id, "idempotency-secret");
    const [webhook] = await db
      .select()
      .from(webhooksTable)
      .where(eq(webhooksTable.contractId, contract.id));
    const [event] = await db
      .insert(eventsTable)
      .values({ contractId: contract.id, ledger: 1, txHash: "5".repeat(64), topic: "[]" })
      .returning({ id: eventsTable.id });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const received: Array<{ id: string | null; event: string | null; attempt: string | null }> = [];
    mswServer.use(
      http.post(WEBHOOK_URL, ({ request }) => {
        received.push({
          id: request.headers.get("x-webhook-id"),
          event: request.headers.get("x-webhook-event"),
          attempt: request.headers.get("x-webhook-attempt")
        });
        return received.length < 3
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json({ ok: true });
      })
    );

    await deliverWebhooksForEvent(db, {
      eventId: event.id,
      contractId: contract.id,
      contractAddress: contractAddress("CONTRACT_HOOK_IDEMPOTENCY"),
      ledger: 1,
      txHash: "5".repeat(64),
      topic: ["transfer", "GABC"],
      value: "1"
    });
    consoleError.mockRestore();

    const expectedId = `wh_${webhook.id}_evt_${event.id}`;
    expect(received).toEqual([
      { id: expectedId, event: "transfer", attempt: "1" },
      { id: expectedId, event: "transfer", attempt: "2" },
      { id: expectedId, event: "transfer", attempt: "3" }
    ]);

    const [delivery] = await db.select().from(webhookDeliveries);
    expect(delivery.status).toBe("success");
    expect(delivery.attempts).toBe(3);
    expect(delivery.idempotencyKey).toBe(expectedId);
  });

  it("sends X-Webhook-Event: unknown when topic[0] is not a string", async () => {
    const db = getTestDb();
    const contract = await registerContract(db, {
      address: contractAddress("CONTRACT_HOOK_UNKNOWN_EVENT"),
      network: NETWORK
    });
    await registerWebhook(contract.id, "unknown-event-secret");
    const [event] = await db
      .insert(eventsTable)
      .values({ contractId: contract.id, ledger: 1, txHash: "6".repeat(64), topic: "[]" })
      .returning({ id: eventsTable.id });

    let eventHeader: string | null = null;
    mswServer.use(
      http.post(WEBHOOK_URL, ({ request }) => {
        eventHeader = request.headers.get("x-webhook-event");
        return HttpResponse.json({ ok: true });
      })
    );

    await deliverWebhooksForEvent(db, {
      eventId: event.id,
      contractId: contract.id,
      contractAddress: contractAddress("CONTRACT_HOOK_UNKNOWN_EVENT"),
      ledger: 1,
      txHash: "6".repeat(64),
      topic: [42],
      value: "1"
    });

    expect(eventHeader).toBe("unknown");
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
