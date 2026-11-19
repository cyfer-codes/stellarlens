import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StrKey } from "@stellar/stellar-sdk";
import { contracts, events } from "@stellarlens/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn("DATABASE_URL is not set; skipping the CLI end-to-end suite (it needs a Postgres to boot the api).");
}

function contractAddress(label: string): string {
  return StrKey.encodeContract(createHash("sha256").update(label).digest());
}

async function seedEvents(harness: Harness, contractId: number, count: number) {
  await harness.db.insert(events).values(
    Array.from({ length: count }, (_, index) => ({
      contractId,
      ledger: 5000 + index,
      txHash: `${String(index).padStart(2, "0")}${"f".repeat(62)}`,
      topic: "transfer",
      decodedData: {
        id: `evt-${index}`,
        type: "contract",
        ledgerClosedAt: "2026-01-01T00:00:00Z",
        inSuccessfulContractCall: true,
        raw: { topic: [], value: "" },
        decoded: { topic: ["transfer", `G${index}`], value: String((index + 1) * 100) }
      },
      createdAt: new Date(Date.UTC(2026, 0, index + 1))
    }))
  );
}

describe.skipIf(!databaseUrl)("stellarlens CLI against a real api", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness(databaseUrl!);
  }, 60_000);

  afterAll(async () => {
    await harness?.stop();
  });

  describe("contracts", () => {
    it("lists nothing before any contract is registered", async () => {
      const result = await harness.cli(["contracts", "list"]);

      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe("No contracts registered.");
    });

    it("adds a contract", async () => {
      const address = contractAddress("cli-add");

      const result = await harness.cli(["contracts", "add", address, "--network", "testnet", "--name", "My token"]);

      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe(`registered contract 1: ${address} (testnet)`);
    });

    it("lists every contract across pages", async () => {
      // 1 from the previous test + 24 more is more than the api's default page of 20.
      await harness.db
        .insert(contracts)
        .values(
          Array.from({ length: 24 }, (_, index) => ({ address: contractAddress(`bulk-${index}`), network: "testnet" }))
        );

      const result = await harness.cli(["contracts", "list"]);

      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(contractAddress("cli-add"));
      expect(result.stdout).toContain("My token");
      for (let index = 0; index < 24; index++) {
        expect(result.stdout).toContain(contractAddress(`bulk-${index}`));
      }
    });

    it("exits non-zero with the api's validation message for an invalid address", async () => {
      const result = await harness.cli(["contracts", "add", "not-an-address", "--network", "testnet"]);

      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/^error: stellarlens api request failed with status 400: .*address/);
    });

    it("exits non-zero when the api key is rejected", async () => {
      const result = await harness.cli(["contracts", "list"], { env: { STELLARLENS_API_KEY: "not-a-real-key" } });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("status 401");
    });

    it("exits non-zero when credentials are missing", async () => {
      const result = await harness.cli(["contracts", "list"], { env: { STELLARLENS_API_KEY: "" } });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("STELLARLENS_API_KEY environment variable is required");
    });
  });

  describe("events", () => {
    let contractId: number;

    beforeAll(async () => {
      const [contract] = await harness.db
        .insert(contracts)
        .values({ address: contractAddress("events-contract"), network: "testnet" })
        .returning();
      contractId = contract.id;
      await seedEvents(harness, contractId, 3);
    });

    it("lists a contract's events", async () => {
      const result = await harness.cli(["events", "list", String(contractId)]);

      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      for (const ledger of ["5000", "5001", "5002"]) {
        expect(result.stdout).toContain(ledger);
      }
      expect(result.stdout).toContain('["transfer","G0"]');
      expect(result.stdout).toContain('"300"');
      expect(result.stdout).not.toContain("next page");
    });

    it("pages with --limit and --cursor", async () => {
      const first = await harness.cli(["events", "list", String(contractId), "--limit", "2"]);

      expect(first.code).toBe(0);
      expect(first.stdout).toContain("5001");
      expect(first.stdout).not.toContain("5002");
      const cursor = first.stdout.match(/--cursor (\d+)/)?.[1];
      expect(cursor).toBeDefined();

      const second = await harness.cli(["events", "list", String(contractId), "--limit", "2", "--cursor", cursor!]);

      expect(second.code).toBe(0);
      expect(second.stdout).toContain("5002");
      expect(second.stdout).not.toContain("5001");
    });

    it("says so when a contract has no events", async () => {
      const [empty] = await harness.db
        .insert(contracts)
        .values({ address: contractAddress("no-events"), network: "testnet" })
        .returning();

      const result = await harness.cli(["events", "list", String(empty.id)]);

      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe("No events found.");
    });

    it("exits non-zero for an unknown contract", async () => {
      const result = await harness.cli(["events", "list", "999999"]);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("status 404");
    });

    it("exports every event to CSV through the real api", async () => {
      const dir = mkdtempSync(join(tmpdir(), "stellarlens-cli-e2e-"));
      try {
        const out = join(dir, "events.csv");
        const result = await harness.cli(["export", "events", String(contractId), "--format", "csv", "--out", out]);

        expect(result.code).toBe(0);
        expect(result.stderr).toContain(`wrote 3 events to ${out}`);
        const lines = readFileSync(out, "utf8").trim().split("\r\n");
        expect(lines[0]).toBe("id,contract_id,ledger,tx_hash,created_at,event_type,topic,value");
        expect(lines).toHaveLength(4);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
