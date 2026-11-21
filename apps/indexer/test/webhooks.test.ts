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
import { assertPublicWebhookUrl, deliverWebhooksForEvent, parseRetryAfterMs } from "../src/webhooks.js";
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
      version: number;
      contractId: number;
      contractAddress: string;
      rpcEventId: string;
      ledger: number;
      ledgerClosedAt: string | null;
      txHash: string;
      inSuccessfulContractCall: boolean;
    };
    expect(payload).toEqual({
      version: 1,
      contractId: contract.id,
      contractAddress: contractAddress("CONTRACT_HOOK"),
      rpcEventId: "0000000000000000000-0000000000",
      ledger: 5005,
      ledgerClosedAt: expect.anything(),
      txHash: "d".repeat(64),
      topic: ["fee"],
      value: "-100",
      inSuccessfulContractCall: expect.any(Boolean)
    });
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
      ledgerClosedAt: new Date(0),
      rpcEventId: "evt-concurrency",
      txHash: "3".repeat(64),
      topic: ["fee"],
      value: "-1",
      inSuccessfulContractCall: true
    });

    expect(maxConcurrentDeliveries).toBeLessThanOrEqual(WEBHOOK_CONCURRENCY);
    expect(maxConcurrentDeliveries).toBe(WEBHOOK_CONCURRENCY);
  });
});
