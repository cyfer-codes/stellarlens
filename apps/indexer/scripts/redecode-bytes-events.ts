/**
 * One-off maintenance script to re-decode stored events that may contain
 * index-keyed objects ({"0":12,"1":255}) produced by previous Buffer serialization.
 *
 * Re-runs `decodeScVal()` against the stored `raw.topic` and `raw.value` XDR strings.
 *
 * Usage:
 *   pnpm --filter @stellarlens/indexer exec tsx scripts/redecode-bytes-events.ts
 */
import { eq, sql } from "drizzle-orm";
import { decodeScVal } from "@stellarlens/decode";
import { events, getDb } from "@stellarlens/db";

export async function redecodeBytesEvents() {
  const db = getDb();
  console.log("Scanning events for stored raw XDR payloads to re-decode...");

  const rows = await db
    .select({
      id: events.id,
      decodedData: events.decodedData
    })
    .from(events)
    .where(sql`${events.decodedData} IS NOT NULL`);

  let updated = 0;
  for (const row of rows) {
    const data = row.decodedData as {
      raw?: { topic?: string[]; value?: string };
      decoded?: { topic?: unknown[]; value?: unknown };
      [key: string]: unknown;
    } | null;

    if (!data?.raw) continue;

    try {
      const newDecodedTopic = Array.isArray(data.raw.topic)
        ? data.raw.topic.map((t) => decodeScVal(t))
        : data.decoded?.topic;
      const newDecodedValue = data.raw.value ? decodeScVal(data.raw.value) : data.decoded?.value;

      const newDecodedData = {
        ...data,
        decoded: {
          topic: newDecodedTopic,
          value: newDecodedValue
        }
      };

      await db.update(events).set({ decodedData: newDecodedData }).where(eq(events.id, row.id));
      updated++;
    } catch (err) {
      console.warn(`Failed to re-decode event id ${row.id}:`, err);
    }
  }

  console.log(`Re-decoding complete. Updated ${updated} of ${rows.length} event records.`);
  return { scanned: rows.length, updated };
}

if (process.env.NODE_ENV !== "test" && typeof require !== "undefined" && require.main === module) {
  redecodeBytesEvents().catch((err) => {
    console.error("Migration script failed:", err);
    process.exit(1);
  });
}
