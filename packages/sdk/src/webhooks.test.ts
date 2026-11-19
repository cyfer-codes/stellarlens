import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signWebhookPayload, verifyWebhookSignature } from "./webhooks.js";

const SECRET = "whsec_test";
const BODY = JSON.stringify({ eventId: 1, contractId: 2, topic: ["transfer"], value: "10" });

describe("signWebhookPayload", () => {
  it("produces the sha256=<hex hmac> format the indexer sends", () => {
    const expected = createHmac("sha256", SECRET).update(BODY).digest("hex");
    expect(signWebhookPayload(BODY, SECRET)).toBe(`sha256=${expected}`);
  });

  it("signs strings and their utf-8 bytes identically", () => {
    expect(signWebhookPayload(Buffer.from(BODY, "utf8"), SECRET)).toBe(signWebhookPayload(BODY, SECRET));
  });
});

describe("verifyWebhookSignature", () => {
  it("accepts a correctly signed body", () => {
    expect(verifyWebhookSignature(BODY, signWebhookPayload(BODY, SECRET), SECRET)).toBe(true);
  });

  it("rejects a signature made with a different secret", () => {
    expect(verifyWebhookSignature(BODY, signWebhookPayload(BODY, "other"), SECRET)).toBe(false);
  });

  it("rejects a tampered body", () => {
    const signature = signWebhookPayload(BODY, SECRET);
    expect(verifyWebhookSignature(BODY.replace("10", "99"), signature, SECRET)).toBe(false);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["unprefixed", createHmac("sha256", SECRET).update(BODY).digest("hex")],
    ["not hex", "sha256=zzzz"],
    ["truncated", signWebhookPayload(BODY, SECRET).slice(0, 20)],
    ["repeated header", [signWebhookPayload(BODY, SECRET), signWebhookPayload(BODY, SECRET)]]
  ])("returns false for a %s header without throwing", (_label, header) => {
    expect(verifyWebhookSignature(BODY, header, SECRET)).toBe(false);
  });
});
