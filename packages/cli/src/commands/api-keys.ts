import { StellarLensApiError, type ApiKey, type StellarLensClient } from "@stellarlens/sdk";

export function formatApiKey(key: ApiKey): Record<string, string | number> {
  return {
    id: key.id,
    name: key.name ?? "—",
    scope: key.scope,
    "created at": key.createdAt,
    status: key.revokedAt ? `revoked at ${key.revokedAt}` : "active"
  };
}

/** Prints every api key (never the raw key value, which the api only returns once, at creation). */
export async function listApiKeys(client: StellarLensClient): Promise<void> {
  const keys = await client.listApiKeys();

  if (keys.length === 0) {
    console.log("No api keys found.");
    return;
  }

  console.table(keys.map(formatApiKey));
}

/**
 * Revokes an api key. A nonexistent id is reported as a clear error (the caller exits non-zero)
 * rather than the raw 404; revoking an already-revoked key succeeds, matching the api's idempotent `DELETE`.
 */
export async function revokeApiKey(client: StellarLensClient, id: number): Promise<void> {
  try {
    await client.revokeApiKey(id);
  } catch (error) {
    if (error instanceof StellarLensApiError && error.status === 404) {
      throw new Error(`api key ${id} not found`);
    }
    throw error;
  }

  console.log(`api key ${id} revoked`);
}
