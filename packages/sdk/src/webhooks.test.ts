import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { timingSafeEqual, verifyWebhookSignature } from "./webhooks.js";

describe("timingSafeEqual", () => {
  it("returns true for identical byte arrays", () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    expect(timingSafeEqual(a, b)).toBe(true);
  });

  it("returns false for different byte arrays of same length", () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 6]);
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it("returns false for byte arrays with different lengths", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it("returns true for two empty byte arrays", () => {
    expect(timingSafeEqual(new Uint8Array([]), new Uint8Array([]))).toBe(true);
  });
});

describe("verifyWebhookSignature", () => {
  const secret = "whsec_stellarlens_test_secret_abc123";
  const eventPayload = {
    eventId: 9876,
    contractId: 42,
    ledger: 5005,
    txHash: "d".repeat(64),
    topic: ["transfer"],
    value: "10000000"
  };
  const body = JSON.stringify(eventPayload);

  // Fixture generated using the exact indexer code pattern from apps/indexer/src/webhooks.ts:
  // createHmac("sha256", webhook.secret).update(body).digest("hex")
  function generateIndexerSignature(b: string, s: string): string {
    return createHmac("sha256", s).update(b).digest("hex");
  }

  describe("legacy indexer signature format", () => {
    it("verifies a valid signature with 'sha256=' prefix", async () => {
      const sigHex = generateIndexerSignature(body, secret);
      const signatureHeader = `sha256=${sigHex}`;

      const isValid = await verifyWebhookSignature({
        body,
        signatureHeader,
        secret
      });

      expect(isValid).toBe(true);
    });

    it("verifies a valid signature without prefix (raw hex)", async () => {
      const sigHex = generateIndexerSignature(body, secret);

      const isValid = await verifyWebhookSignature({
        body,
        signatureHeader: sigHex,
        secret
      });

      expect(isValid).toBe(true);
    });

    it("verifies when body is passed as Uint8Array", async () => {
      const sigHex = generateIndexerSignature(body, secret);
      const bodyBytes = new TextEncoder().encode(body);

      const isValid = await verifyWebhookSignature({
        body: bodyBytes,
        signatureHeader: `sha256=${sigHex}`,
        secret
      });

      expect(isValid).toBe(true);
    });

    it("rejects an invalid signature with modified body", async () => {
      const sigHex = generateIndexerSignature(body, secret);
      const tamperedBody = JSON.stringify({ ...eventPayload, value: "99999999" });

      const isValid = await verifyWebhookSignature({
        body: tamperedBody,
        signatureHeader: `sha256=${sigHex}`,
        secret
      });

      expect(isValid).toBe(false);
    });

    it("rejects an invalid signature with wrong secret", async () => {
      const sigHex = generateIndexerSignature(body, "different-secret");

      const isValid = await verifyWebhookSignature({
        body,
        signatureHeader: `sha256=${sigHex}`,
        secret
      });

      expect(isValid).toBe(false);
    });

    it("rejects corrupted signature hex", async () => {
      const isValid = await verifyWebhookSignature({
        body,
        signatureHeader: "sha256=invalidhex123",
        secret
      });

      expect(isValid).toBe(false);
    });

    it("rejects empty signature or secret", async () => {
      expect(await verifyWebhookSignature({ body, signatureHeader: "", secret })).toBe(false);
      expect(
        await verifyWebhookSignature({
          body,
          signatureHeader: "sha256=abcdef",
          secret: ""
        })
      ).toBe(false);
    });
  });

  describe("timestamped signature format", () => {
    it("verifies combined t=timestamp,v1=signature header within tolerance", async () => {
      const now = Math.floor(Date.now() / 1000);
      const payloadToSign = `${now}.${body}`;
      const sigHex = generateIndexerSignature(payloadToSign, secret);
      const signatureHeader = `t=${now},v1=${sigHex}`;

      const isValid = await verifyWebhookSignature({
        body,
        signatureHeader,
        secret,
        toleranceSeconds: 300
      });

      expect(isValid).toBe(true);
    });

    it("verifies combined t=timestamp,sha256=signature format", async () => {
      const now = Math.floor(Date.now() / 1000);
      const payloadToSign = `${now}.${body}`;
      const sigHex = generateIndexerSignature(payloadToSign, secret);
      const signatureHeader = `t=${now},sha256=${sigHex}`;

      const isValid = await verifyWebhookSignature({
        body,
        signatureHeader,
        secret
      });

      expect(isValid).toBe(true);
    });

    it("verifies separate timestampHeader within tolerance", async () => {
      const now = Math.floor(Date.now() / 1000);
      const payloadToSign = `${now}.${body}`;
      const sigHex = generateIndexerSignature(payloadToSign, secret);

      const isValid = await verifyWebhookSignature({
        body,
        signatureHeader: `v1=${sigHex}`,
        timestampHeader: String(now),
        secret,
        toleranceSeconds: 120
      });

      expect(isValid).toBe(true);
    });

    it("supports multiple signatures (e.g. key rotation v1=sig1,v1=sig2)", async () => {
      const now = Math.floor(Date.now() / 1000);
      const payloadToSign = `${now}.${body}`;
      const validSig = generateIndexerSignature(payloadToSign, secret);
      const oldSig = generateIndexerSignature(payloadToSign, "old-rotated-secret");

      const signatureHeader = `t=${now},v1=${oldSig},v1=${validSig}`;

      const isValid = await verifyWebhookSignature({
        body,
        signatureHeader,
        secret
      });

      expect(isValid).toBe(true);
    });

    it("rejects an expired webhook that exceeds toleranceSeconds", async () => {
      const expiredTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const payloadToSign = `${expiredTimestamp}.${body}`;
      const sigHex = generateIndexerSignature(payloadToSign, secret);

      const isValid = await verifyWebhookSignature({
        body,
        signatureHeader: `t=${expiredTimestamp},v1=${sigHex}`,
        secret,
        toleranceSeconds: 300 // 5 minutes tolerance
      });

      expect(isValid).toBe(false);
    });

    it("rejects a future timestamp that exceeds toleranceSeconds", async () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 600; // 10 minutes in the future
      const payloadToSign = `${futureTimestamp}.${body}`;
      const sigHex = generateIndexerSignature(payloadToSign, secret);

      const isValid = await verifyWebhookSignature({
        body,
        signatureHeader: `t=${futureTimestamp},v1=${sigHex}`,
        secret,
        toleranceSeconds: 300
      });

      expect(isValid).toBe(false);
    });

    it("allows bypassing tolerance check when toleranceSeconds is 0", async () => {
      const ancientTimestamp = 1600000000;
      const payloadToSign = `${ancientTimestamp}.${body}`;
      const sigHex = generateIndexerSignature(payloadToSign, secret);

      const isValid = await verifyWebhookSignature({
        body,
        signatureHeader: `t=${ancientTimestamp},v1=${sigHex}`,
        secret,
        toleranceSeconds: 0
      });

      expect(isValid).toBe(true);
    });

    it("verifies legacy payload signature accompanied by a timestamp header for freshness", async () => {
      const now = Math.floor(Date.now() / 1000);
      const legacySig = generateIndexerSignature(body, secret);

      const isValid = await verifyWebhookSignature({
        body,
        signatureHeader: `sha256=${legacySig}`,
        timestampHeader: String(now),
        secret,
        toleranceSeconds: 300
      });

      expect(isValid).toBe(true);
    });
  });

  describe("indexer fixture reproduction", () => {
    it("matches exact hardcoded fixture from indexer delivery specs", async () => {
      // Deterministic fixture
      const fixtureSecret = "indexer-fixture-secret";
      const fixtureBody = '{"contractId":1,"ledger":5005,"txHash":"dddddddd"}';
      const expectedFixtureSig = createHmac("sha256", fixtureSecret)
        .update(fixtureBody)
        .digest("hex");

      const header = `sha256=${expectedFixtureSig}`;

      const verified = await verifyWebhookSignature({
        body: fixtureBody,
        signatureHeader: header,
        secret: fixtureSecret
      });

      expect(verified).toBe(true);
    });
  });
});
