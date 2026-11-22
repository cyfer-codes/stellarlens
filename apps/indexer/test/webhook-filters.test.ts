import { describe, expect, it } from "vitest";
import { matchesFilter, type WebhookEventPayload } from "../src/webhooks.js";

function makePayload(topics: unknown[]): WebhookEventPayload {
  return {
    eventId: 1,
    contractId: 10,
    contractAddress: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    ledger: 100,
    txHash: "a".repeat(64),
    topic: topics,
    value: "some-value"
  };
}

describe("matchesFilter - positional matching and wildcards (#257)", () => {
  it("matches all events when neither eventTypes nor filter is set", () => {
    const payload = makePayload(["transfer", "GA...", "GB..."]);
    expect(matchesFilter({}, payload)).toBe(true);
    expect(matchesFilter({ eventTypes: null, filter: null }, payload)).toBe(true);
    expect(matchesFilter({ eventTypes: [], filter: {} }, payload)).toBe(true);
  });

  describe("eventTypes matching", () => {
    it("matches when topic[0] is in eventTypes", () => {
      const payload = makePayload(["transfer", "GA..."]);
      expect(matchesFilter({ eventTypes: ["transfer", "mint"] }, payload)).toBe(true);
    });

    it("does not match when topic[0] is not in eventTypes", () => {
      const payload = makePayload(["burn", "GA..."]);
      expect(matchesFilter({ eventTypes: ["transfer", "mint"] }, payload)).toBe(false);
    });
  });

  describe("positional topic matching", () => {
    it("matches exact topics at every position", () => {
      const payload = makePayload(["transfer", "G_FROM", "G_TO"]);
      const filter = { topics: ["transfer", "G_FROM", "G_TO"] };
      expect(matchesFilter({ filter }, payload)).toBe(true);
    });

    it("rejects when a positional topic differs", () => {
      const payload = makePayload(["transfer", "G_OTHER", "G_TO"]);
      const filter = { topics: ["transfer", "G_FROM", "G_TO"] };
      expect(matchesFilter({ filter }, payload)).toBe(false);
    });

    it("allows payload to have more topics than filter", () => {
      const payload = makePayload(["transfer", "G_FROM", "G_TO", "EXTRA"]);
      const filter = { topics: ["transfer", "G_FROM"] };
      expect(matchesFilter({ filter }, payload)).toBe(true);
    });

    it("rejects when event has fewer topics than filter requires", () => {
      const payload = makePayload(["transfer"]);
      const filter = { topics: ["transfer", null, "G_TO"] };
      expect(matchesFilter({ filter }, payload)).toBe(false);
    });
  });

  describe("wildcard matching with null", () => {
    it("matches any topic at the wildcard position (null in middle)", () => {
      const filter = { topics: ["transfer", null, "G_RECIPIENT"] };

      const matched1 = makePayload(["transfer", "G_USER_1", "G_RECIPIENT"]);
      const matched2 = makePayload(["transfer", "G_USER_2", "G_RECIPIENT"]);
      const unmatched = makePayload(["transfer", "G_USER_1", "G_WRONG_RECIPIENT"]);

      expect(matchesFilter({ filter }, matched1)).toBe(true);
      expect(matchesFilter({ filter }, matched2)).toBe(true);
      expect(matchesFilter({ filter }, unmatched)).toBe(false);
    });

    it("matches any topic at the beginning (null as topic[0])", () => {
      const filter = { topics: [null, "G_TARGET"] };

      expect(matchesFilter({ filter }, makePayload(["mint", "G_TARGET"]))).toBe(true);
      expect(matchesFilter({ filter }, makePayload(["transfer", "G_TARGET"]))).toBe(true);
      expect(matchesFilter({ filter }, makePayload(["burn", "G_OTHER"]))).toBe(false);
    });

    it("matches when all positions are wildcards as long as length is satisfied", () => {
      const filter = { topics: [null, null, null] };

      expect(matchesFilter({ filter }, makePayload(["a", "b", "c"]))).toBe(true);
      expect(matchesFilter({ filter }, makePayload(["a", "b"]))).toBe(false);
    });
  });

  describe("combined eventTypes and filter", () => {
    it("matches only when both eventTypes and structured filter pass", () => {
      const subscription = {
        eventTypes: ["transfer", "mint"],
        filter: { topics: [null, null, "G_VIP"] }
      };

      // Both pass
      expect(matchesFilter(subscription, makePayload(["transfer", "G_FROM", "G_VIP"]))).toBe(true);
      expect(matchesFilter(subscription, makePayload(["mint", "G_ADMIN", "G_VIP"]))).toBe(true);

      // eventTypes fails
      expect(matchesFilter(subscription, makePayload(["burn", "G_FROM", "G_VIP"]))).toBe(false);

      // filter fails (wrong recipient)
      expect(matchesFilter(subscription, makePayload(["transfer", "G_FROM", "G_OTHER"]))).toBe(false);
    });
  });
});
