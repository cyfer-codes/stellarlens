import "dotenv/config";
import { createHash } from "node:crypto";
import { apiKeys, createDb } from "@stellarlens/db";

/**
 * Registers the raw key in `API_KEY` (the one the dashboard itself sends to the api) so a fresh
 * stack works without first logging in to generate one. Idempotent: an existing key with the same
 * hash is left untouched. Intended for local/docker setups; production keys should be generated
 * from Settings.
 */
async function main() {
  const rawKey = process.env.API_KEY;

  if (!rawKey) {
    console.error("API_KEY environment variable is required");
    process.exit(1);
  }

  const db = createDb();
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const inserted = await db
    .insert(apiKeys)
    .values({ keyHash, name: "dashboard (seeded)" })
    .onConflictDoNothing({ target: apiKeys.keyHash })
    .returning({ id: apiKeys.id });

  console.log(inserted.length > 0 ? "seeded dashboard api key" : "dashboard api key already exists, skipping");
  process.exit(0);
}

main();
