import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { apiKeys, createDb, type Database } from "@stellarlens/db";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export const CLI_BIN = resolve(repoRoot, "packages/cli/dist/index.js");
const API_MAIN = resolve(repoRoot, "apps/api/dist/main.js");
const MIGRATIONS = resolve(repoRoot, "packages/db/migrations");

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface Harness {
  apiUrl: string;
  /** A key minted through the api's own POST /api-keys, the way a real user would get one. */
  apiKey: string;
  db: Database;
  /** Runs the *built* CLI binary as a separate process, exactly as a user would. */
  cli(args: string[], options?: { env?: Record<string, string>; input?: string }): Promise<CliResult>;
  stop(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolvePort(port));
    });
  });
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, input?: string): Promise<CliResult> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolveRun({ code, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

async function waitForHealthy(url: string, api: ChildProcess, logs: () => string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (api.exitCode !== null) {
      throw new Error(`api exited with code ${api.exitCode} before becoming healthy:\n${logs()}`);
    }
    try {
      const response = await fetch(`${url}/health/ready`);
      if (response.ok) {
        return;
      }
    } catch {
      // not listening yet
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`api did not become healthy within 30s:\n${logs()}`);
}

/**
 * Boots the real, built api against a throwaway database on the Postgres at `DATABASE_URL` (the CI service),
 * mints an api key through the api, and hands back a runner for the built CLI binary.
 *
 * Each harness gets its own freshly migrated database, dropped on `stop()`, so it never races the api and
 * indexer suites, which truncate tables in the shared database while turbo runs tasks in parallel.
 */
export async function startHarness(databaseUrl: string): Promise<Harness> {
  const dbName = `stellarlens_cli_e2e_${process.pid}_${randomBytes(4).toString("hex")}`;
  const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${dbName}"`);

  const isolatedUrl = new URL(databaseUrl);
  isolatedUrl.pathname = `/${dbName}`;

  const db = createDb(isolatedUrl.toString());
  let api: ChildProcess | undefined;

  const stop = async () => {
    if (api && api.exitCode === null) {
      const exited = new Promise((resolveExit) => api!.once("exit", resolveExit));
      api.kill("SIGTERM");
      await exited;
    }
    await db.$client.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.end();
  };

  try {
    await migrate(db, { migrationsFolder: MIGRATIONS });

    // The api only mints keys for callers that already hold a full-scope key, so seed one directly.
    const bootstrapKey = randomBytes(24).toString("hex");
    await db.insert(apiKeys).values({
      keyHash: createHash("sha256").update(bootstrapKey).digest("hex"),
      name: "cli-e2e-bootstrap",
      scope: "full"
    });

    const port = await freePort();
    const apiUrl = `http://127.0.0.1:${port}`;
    let apiLogs = "";
    api = spawn(process.execPath, [API_MAIN], {
      env: { ...process.env, DATABASE_URL: isolatedUrl.toString(), PORT: String(port), NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    api.stdout!.on("data", (chunk) => (apiLogs += chunk));
    api.stderr!.on("data", (chunk) => (apiLogs += chunk));
    await waitForHealthy(apiUrl, api, () => apiLogs);

    const response = await fetch(`${apiUrl}/api-keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": bootstrapKey },
      body: JSON.stringify({ name: "cli-e2e" })
    });
    if (response.status !== 201) {
      throw new Error(`creating an api key failed with ${response.status}: ${await response.text()}`);
    }
    const { key: apiKey } = (await response.json()) as { key: string };

    return {
      apiUrl,
      apiKey,
      db,
      cli: (args, options = {}) =>
        run(
          process.execPath,
          [CLI_BIN, ...args],
          {
            PATH: process.env.PATH,
            STELLARLENS_API_URL: apiUrl,
            STELLARLENS_API_KEY: apiKey,
            ...options.env
          },
          options.input
        ),
      stop
    };
  } catch (err) {
    await stop().catch(() => {});
    throw err;
  }
}
