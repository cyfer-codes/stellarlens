import type { Database } from "@stellarlens/db";
import { describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({ and: vi.fn(), eq: vi.fn() }));
vi.mock("@stellarlens/db", () => ({
  webhookDeliveries: {},
  webhooks: { contractId: {}, active: {} }
}));
// The private-destination check resolves the hostname before fetch; let it pass so the
// DNS failure under test comes from fetch itself.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }])
}));

import { deliverWebhooksForEvent } from "../src/webhooks.js";

const WEBHOOK_URL = "https://unresolvable.example/webhook";

describe("webhook DNS failures", () => {
  it("logs and records a DNS failure without retrying the delivery", async () => {
    const dnsCause = Object.assign(new Error("getaddrinfo ENOTFOUND unresolvable.example"), { code: "ENOTFOUND" });
    const fetchError = new TypeError("fetch failed", { cause: dnsCause });
    const fetchSpy = vi.fn().mockRejectedValue(fetchError);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const insertValues = vi.fn().mockResolvedValue(undefined);
    const webhook = {
      id: 7,
      contractId: 3,
      url: WEBHOOK_URL,
      secret: "test-secret",
      eventTypes: null,
      createdAt: new Date()
    };
    const db = {
      select: () => ({ from: () => ({ where: async () => [webhook] }) }),
      insert: () => ({ values: insertValues })
    } as unknown as Database;

    vi.stubGlobal("fetch", fetchSpy);

    try {
      await deliverWebhooksForEvent(db, {
        eventId: 42,
        contractId: 3,
        contractAddress: "CONTRACT_DNS_FAILURE",
        ledger: 100,
        txHash: "a".repeat(64),
        topic: ["transfer"],
        value: "1"
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          attempts: 1,
          lastError: expect.stringContaining(`DNS resolution failed for ${WEBHOOK_URL}`)
        })
      );
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("is unreachable due to DNS resolution failure"),
        fetchError
      );
    } finally {
      vi.unstubAllGlobals();
      consoleError.mockRestore();
    }
  });
});
