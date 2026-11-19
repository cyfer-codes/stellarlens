/**
 * Regenerates test/fixtures/webhook-signatures.json using the indexer's real signer, so the SDK's
 * verifyWebhookSignature is tested against exactly what the indexer produces.
 *
 *   pnpm --filter @stellarlens/indexer exec tsx scripts/generate-webhook-fixtures.ts
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { signWebhookPayload } from "../src/webhook-signature.js";

const secret = "whsec_test_9f2c1b7e4a";
const body = JSON.stringify({
  eventId: 4211,
  contractId: 7,
  ledger: 512_345,
  txHash: "3f5a".repeat(16),
  topic: ["transfer", "GAFROM…", "GBTO…"],
  value: { amount: "1250000000", to_muxed_id: "42", memo: "café ☕" }
});
const emptyBody = "";
const timestamp = 1_763_510_400;

const fixtures = {
  secret,
  cases: [
    { name: "legacy", body, signatureHeader: signWebhookPayload(secret, body) },
    { name: "legacy-empty-body", body: emptyBody, signatureHeader: signWebhookPayload(secret, emptyBody) },
    {
      name: "timestamped",
      body,
      timestamp,
      signatureHeader: signWebhookPayload(secret, body, timestamp)
    }
  ]
};

const out = fileURLToPath(new URL("../test/fixtures/webhook-signatures.json", import.meta.url));
writeFileSync(out, `${JSON.stringify(fixtures, null, 2)}\n`);
console.log(`wrote ${out}`);
