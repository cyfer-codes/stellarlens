import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { contracts, webhooks as webhooksTable } from "@stellarlens/db";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { STELLAR_NETWORK as NETWORK } from "../src/config.js";
import { processEventsBatch } from "../src/events.js";
import { registerContract } from "../src/registry.js";
import { mockJsonRpc, TEST_RPC_URL } from "./rpc-mocks.js";
import { getTestDb, mswServer } from "./setup.js";

const WEBHOOK_URL = "http://localhost:9999/webhook-endpoint";

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

async function registerWebhook(contractId: number, secret: string) {
  const db = getTestDb();
  await db.insert(webhooksTable).values({ contractId, url: WEBHOOK_URL, secret });
}

describe("webhook delivery", () => {
  it("fires a signed POST to every webhook registered for the indexed event's contract", async () => {
    const db = getTestDb();
    const contract = await registerContract(db, { address: "CONTRACT_HOOK", network: NETWORK });
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
              contractId: "CONTRACT_HOOK",
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

    const payload = JSON.parse(receivedBody) as { contractId: number; ledger: number; txHash: string };
    expect(payload.contractId).toBe(contract.id);
    expect(payload.ledger).toBe(5005);
    expect(payload.txHash).toBe("d".repeat(64));
  });

  it("retries a failing webhook before giving up, without failing the indexing batch", async () => {
    const db = getTestDb();
    const contract = await registerContract(db, { address: "CONTRACT_HOOK_RETRY", network: NETWORK });
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
              contractId: "CONTRACT_HOOK_RETRY",
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

  it("does not throw when a webhook contract has no registered endpoints", async () => {
    const db = getTestDb();
    await registerContract(db, { address: "CONTRACT_NO_HOOK", network: NETWORK });

    mswServer.use(
      mockJsonRpc({
        getLatestLedger: () => buildLatestLedger(7000),
        getEvents: () => ({
          events: [
            {
              id: "0000000000000000000-0000000000",
              ledger: 7005,
              txHash: "f".repeat(64),
              contractId: "CONTRACT_NO_HOOK",
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

    const [row] = await db.select().from(contracts).where(eq(contracts.address, "CONTRACT_NO_HOOK"));
    expect(row).toBeDefined();
  });
});
