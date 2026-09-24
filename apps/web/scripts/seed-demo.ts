import "dotenv/config";
import { eq } from "drizzle-orm";
import { contracts, createDb, events, tokenTransfers } from "@stellarlens/db";

/**
 * Populates a few realistic-looking contracts with historical events and
 * transfers, so a PUBLIC_DEMO deployment has real-looking data to browse
 * without anyone registering a contract themselves. Deterministic (fixed
 * RNG seed) so re-running is a no-op once seeded.
 */

const STRKEY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const SEED = 20260923;

const DEMO_CONTRACTS = [
  { name: "Demo — USD Stable", network: "testnet" },
  { name: "Demo — Rewards Token", network: "testnet" },
  { name: "Demo — Governance Token", network: "testnet" }
];

function mulberry32(seed: number): () => number {
  let state = seed;
  return function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomStrkey(random: () => number, prefix: "C" | "G"): string {
  let out = prefix;
  for (let i = 0; i < 55; i += 1) {
    out += STRKEY_ALPHABET[Math.floor(random() * STRKEY_ALPHABET.length)];
  }
  return out;
}

function randomTxHash(random: () => number): string {
  let out = "";
  for (let i = 0; i < 64; i += 1) {
    out += Math.floor(random() * 16).toString(16);
  }
  return out;
}

function pick<T>(random: () => number, items: T[]): T {
  return items[Math.floor(random() * items.length)];
}

async function main() {
  const db = createDb();
  const random = mulberry32(SEED);

  const existing = await db.select({ name: contracts.name }).from(contracts);
  const existingNames = new Set(existing.map((row) => row.name));
  if (DEMO_CONTRACTS.every((demo) => existingNames.has(demo.name))) {
    console.log("demo contracts already seeded, skipping");
    process.exit(0);
  }

  const participants = Array.from({ length: 12 }, () => randomStrkey(random, "G"));

  for (const demo of DEMO_CONTRACTS) {
    const address = randomStrkey(random, "C");

    const [inserted] = await db
      .insert(contracts)
      .values({ address, name: demo.name, network: demo.network })
      .onConflictDoNothing({ target: contracts.address })
      .returning();
    const [contract] = inserted ? [inserted] : await db.select().from(contracts).where(eq(contracts.address, address));

    const eventCount = 20 + Math.floor(random() * 15);
    let ledger = 500_000 + Math.floor(random() * 50_000);
    const now = Date.now();

    for (let i = eventCount; i > 0; i -= 1) {
      const createdAt = new Date(now - i * (10 + random() * 20) * 60 * 60 * 1000);
      ledger += 1 + Math.floor(random() * 40);
      const txHash = randomTxHash(random);
      const roll = random();

      let topic: unknown[];
      let value: unknown;
      let transfer: { from: string; to: string; amount: string } | undefined;

      if (roll < 0.7) {
        const from = pick(random, participants);
        let to = pick(random, participants);
        while (to === from) {
          to = pick(random, participants);
        }
        const amount = String(1_000 + Math.floor(random() * 500_000));
        topic = ["transfer", from, to];
        value = amount;
        transfer = { from, to, amount };
      } else if (roll < 0.85) {
        topic = ["mint", pick(random, participants)];
        value = String(1_000 + Math.floor(random() * 100_000));
      } else {
        topic = ["approve", pick(random, participants), pick(random, participants)];
        value = String(1_000 + Math.floor(random() * 100_000));
      }

      await db.insert(events).values({
        contractId: contract.id,
        ledger,
        txHash,
        topic: JSON.stringify(topic),
        decodedData: {
          id: `${ledger}-${i}`,
          type: "contract",
          ledgerClosedAt: createdAt.toISOString(),
          inSuccessfulContractCall: true,
          raw: { topic, value },
          decoded: { topic, value }
        },
        createdAt
      });

      if (transfer) {
        await db.insert(tokenTransfers).values({
          contractId: contract.id,
          from: transfer.from,
          to: transfer.to,
          amount: transfer.amount,
          asset: address,
          txHash,
          ledger,
          createdAt
        });
      }
    }

    console.log(`seeded ${eventCount} events for "${demo.name}" (${address})`);
  }

  console.log("demo seed complete");
  process.exit(0);
}

main();
