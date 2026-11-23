#!/usr/bin/env tsx
/**
 * Re-decode job for events stored with `decodeErrors`.
 *
 * Usage:
 *   pnpm --filter @stellarlens/indexer redecode [options]
 *
 * Options:
 *   --dry-run             Scan and report without writing to the database.
 *   --from-ledger <n>     Only process events with ledger >= n.
 *   --to-ledger <n>       Only process events with ledger <= n.
 *   --batch-size <n>      Number of events to process per batch (default: 500).
 *   --all                 Re-decode all events in the ledger range, not just those with decodeErrors.
 *   --help                Show this help message.
 *
 * By default, only events that have `decodeErrors` in their `decodedData` are
 * re-decoded. Pass `--all` (optionally with a ledger range) to re-decode every
 * event in scope.
 */

import { parseArgs } from "node:util";
import { and, asc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";

import { db } from "../src/db.js";
import { events, transfers } from "../src/schema.js";
import { decodeEvent, detectTransfers } from "../src/decode.js";
import { logger } from "../src/logger.js";

interface Options {
  dryRun: boolean;
  fromLedger: number | undefined;
  toLedger: number | undefined;
  batchSize: number;
  all: boolean;
}

interface Summary {
  scanned: number;
  updated: number;
  failed: number;
  transfersInserted: number;
  transfersSkipped: number;
}

const DEFAULT_BATCH_SIZE = 500;

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: pnpm --filter @stellarlens/indexer redecode [options]",
      "",
      "Options:",
      "  --dry-run             Scan and report without writing to the database.",
      "  --from-ledger <n>     Only process events with ledger >= n.",
      "  --to-ledger <n>       Only process events with ledger <= n.",
      "  --batch-size <n>      Number of events to process per batch (default: 500).",
      "  --all                 Re-decode all events in the ledger range, not just those with decodeErrors.",
      "  --help                Show this help message.",
      "",
    ].join("\n"),
  );
}

function parsePositiveInt(name: string, raw: string | undefined): number {
  if (raw === undefined) {
    throw new Error(`Missing value for ${name}`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid value for ${name}: ${raw}`);
  }
  return value;
}

function parseOptions(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      "dry-run": { type: "boolean", default: false },
      "from-ledger": { type: "string" },
      "to-ledger": { type: "string" },
      "batch-size": { type: "string" },
      all: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const fromLedger =
    values["from-ledger"] !== undefined
      ? parsePositiveInt("--from-ledger", values["from-ledger"])
      : undefined;
  const toLedger =
    values["to-ledger"] !== undefined
      ? parsePositiveInt("--to-ledger", values["to-ledger"])
      : undefined;

  if (fromLedger !== undefined && toLedger !== undefined && fromLedger > toLedger) {
    throw new Error(
      `--from-ledger (${fromLedger}) must be <= --to-ledger (${toLedger})`,
    );
  }

  const batchSize =
    values["batch-size"] !== undefined
      ? parsePositiveInt("--batch-size", values["batch-size"])
      : DEFAULT_BATCH_SIZE;

  if (batchSize <= 0) {
    throw new Error(`--batch-size must be a positive integer`);
  }

  return {
    dryRun: values["dry-run"] ?? false,
    fromLedger,
    toLedger,
    batchSize,
    all: values.all ?? false,
  };
}

/**
 * Build the WHERE clause for selecting events to re-decode.
 *
 * By default we only pick rows whose `decodedData` contains a non-empty
 * `decodeErrors` array. When `all` is set, we process every event in the
 * ledger range.
 */
function buildWhere(options: Options) {
  const conditions = [];

  if (!options.all) {
    conditions.push(
      sql`jsonb_array_length(coalesce(${events.decodedData} -> 'decodeErrors', '[]'::jsonb)) > 0`,
    );
  }

  if (options.fromLedger !== undefined) {
    conditions.push(gte(events.ledger, options.fromLedger));
  }

  if (options.toLedger !== undefined) {
    conditions.push(lte(events.ledger, options.toLedger));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

interface EventRow {
  id: number;
  rpcEventId: string;
  contractAddress: string;
  ledger: number;
  rawXdr: string;
  decodedData: unknown;
}

async function processBatch(
  rows: EventRow[],
  options: Options,
  summary: Summary,
): Promise<void> {
  for (const row of rows) {
    summary.scanned += 1;

    const logContext = {
      eventId: row.id,
      rpcEventId: row.rpcEventId,
      contractAddress: row.contractAddress,
      ledger: row.ledger,
    };

    let decoded: ReturnType<typeof decodeEvent>;
    try {
      decoded = decodeEvent(row.rawXdr);
    } catch (err) {
      summary.failed += 1;
      logger.error(
        { ...logContext, err: err instanceof Error ? err.message : String(err) },
        "re-decode failed: decoder threw",
      );
      continue;
    }

    if (decoded.decodeErrors && decoded.decodeErrors.length > 0) {
      summary.failed += 1;
      logger.warn(
        { ...logContext, decodeErrors: decoded.decodeErrors },
        "re-decode failed: still has decodeErrors",
      );
      continue;
    }

    // Re-detect transfers from the freshly decoded event.
    let detected: ReturnType<typeof detectTransfers>;
    try {
      detected = detectTransfers(decoded);
    } catch (err) {
      summary.failed += 1;
      logger.error(
        { ...logContext, err: err instanceof Error ? err.message : String(err) },
        "re-decode failed: transfer detection threw",
      );
      continue;
    }

    if (options.dryRun) {
      summary.updated += 1;
      summary.transfersSkipped += detected.length;
      logger.info(
        { ...logContext, transfers: detected.length, dryRun: true },
        "would update event",
      );
      continue;
    }

    try {
      await db.transaction(async (tx) => {
        await tx
          .update(events)
          .set({ decodedData: decoded })
          .where(eq(events.id, row.id));

        if (detected.length > 0) {
          const inserted = await tx
            .insert(transfers)
            .values(
              detected.map((transfer) => ({
                rpcEventId: row.rpcEventId,
                contractAddress: row.contractAddress,
                ledger: row.ledger,
                ...transfer,
              })),
            )
            .onConflictDoNothing({ target: transfers.rpcEventId })
            .returning({ id: transfers.id });

          summary.transfersInserted += inserted.length;
          summary.transfersSkipped += detected.length - inserted.length;
        }
      });

      summary.updated += 1;
      logger.info(
        { ...logContext, transfers: detected.length },
        "event re-decoded",
      );
    } catch (err) {
      summary.failed += 1;
      logger.error(
        { ...logContext, err: err instanceof Error ? err.message : String(err) },
        "re-decode failed: database write failed",
      );
    }
  }
}

async function run(options: Options): Promise<Summary> {
  const summary: Summary = {
    scanned: 0,
    updated: 0,
    failed: 0,
    transfersInserted: 0,
    transfersSkipped: 0,
  };

  const where = buildWhere(options);

  logger.info(
    {
      dryRun: options.dryRun,
      fromLedger: options.fromLedger ?? null,
      toLedger: options.toLedger ?? null,
      batchSize: options.batchSize,
      all: options.all,
    },
    "starting re-decode job",
  );

  let lastId = 0;

  // Paginate by primary key to keep batches bounded and stable.
  for (;;) {
    const rows = (await db
      .select({
        id: events.id,
        rpcEventId: events.rpcEventId,
        contractAddress: events.contractAddress,
        ledger: events.ledger,
        rawXdr: events.rawXdr,
        decodedData: events.decodedData,
      })
      .from(events)
      .where(
        where
          ? and(where, sql`${events.id} > ${lastId}`)
          : sql`${events.id} > ${lastId}`,
      )
      .orderBy(asc(events.id))
      .limit(options.batchSize)) as EventRow[];

    if (rows.length === 0) {
      break;
    }

    await processBatch(rows, options, summary);

    lastId = rows[rows.length - 1]!.id;

    logger.info(
      {
        scanned: summary.scanned,
        updated: summary.updated,
        failed: summary.failed,
        lastId,
      },
      "batch processed",
    );

    if (rows.length < options.batchSize) {
      break;
    }
  }

  return summary;
}

async function main(): Promise<void> {
  let options: Options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "invalid arguments",
    );
    printHelp();
    process.exit(1);
  }

  try {
    const summary = await run(options);

    logger.info(
      {
        dryRun: options.dryRun,
        scanned: summary.scanned,
        updated: summary.updated,
        failed: summary.failed,
        transfersInserted: summary.transfersInserted,
        transfersSkipped: summary.transfersSkipped,
      },
      "re-decode job complete",
    );

    process.stdout.write(
      [
        "",
        "Re-decode summary",
        "-----------------",
        `Mode:               ${options.dryRun ? "dry-run" : "write"}`,
        `Events scanned:     ${summary.scanned}`,
        `Events updated:     ${summary.updated}`,
        `Events failed:      ${summary.failed}`,
        `Transfers inserted: ${summary.transfersInserted}`,
        `Transfers skipped:  ${summary.transfersSkipped}`,
        "",
      ].join("\n"),
    );

    if (summary.failed > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "re-decode job crashed",
    );
    process.exit(1);
  }
}

void main();