import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { signWebhookPayload } from "../src/webhook-signature.js";

interface SignatureFixtures {
  secret: string;
  cases: Array<{ name: string; body: string; timestamp?: number; signatureHeader: string }>;
}

// Shared with packages/sdk (verifyWebhookSignature). Regenerate with scripts/generate-webhook-fixtures.ts.
const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/webhook-signatures.json", import.meta.url), "utf8")
) as SignatureFixtures;

describe("signWebhookPayload", () => {
  it("signs the raw body in the legacy sha256=<hex> format", () => {
    const expected = createHmac("sha256", "s3cret").update('{"a":1}').digest("hex");
    expect(signWebhookPayload("s3cret", '{"a":1}')).toBe(`sha256=${expected}`);
  });

  it("binds the timestamp into the timestamped format", () => {
    const expected = createHmac("sha256", "s3cret").update('1700000000.{"a":1}').digest("hex");
    expect(signWebhookPayload("s3cret", '{"a":1}', 1_700_000_000)).toBe(`sha256=${expected}`);
  });

  it.each(fixtures.cases)("still produces the shared SDK fixture: $name", (fixture) => {
    expect(signWebhookPayload(fixtures.secret, fixture.body, fixture.timestamp)).toBe(fixture.signatureHeader);
  });
});
