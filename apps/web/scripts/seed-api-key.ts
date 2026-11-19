import "dotenv/config";
import { generateApiKey } from "../lib/apiKeys";

/**
 * Generates a full-scope api key and prints only the raw key to stdout, so
 * CI (or a local e2e run) can capture it and export it as API_KEY for the
 * web app to proxy requests to the api with. There's no "get or create" here
 * — each run mints a new key — so callers should only run this once per
 * database.
 */
async function main() {
  const name = process.env.API_KEY_NAME ?? "e2e";
  const created = await generateApiKey(name);
  process.stdout.write(`${created.key}\n`);
  process.exit(0);
}

main();
