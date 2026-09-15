import { StellarLensClient } from "@stellarlens/sdk";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required (see \`stellarlens --help\`)`);
  }
  return value;
}

export function createClientFromEnv(): StellarLensClient {
  return new StellarLensClient({
    baseUrl: requireEnv("STELLARLENS_API_URL"),
    apiKey: requireEnv("STELLARLENS_API_KEY")
  });
}
