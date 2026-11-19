#!/usr/bin/env node
import { Argument, Command, InvalidArgumentError, Option } from "commander";
import { createClientFromEnv } from "./client.js";
import { addContract, listContracts } from "./commands/contracts.js";
import { runDecode } from "./commands/decode.js";
import { StellarLensApiError } from "@stellarlens/sdk";
import { listEvents, tailEvents } from "./commands/events.js";
import { runExport, type ExportFormat, type ExportKind } from "./commands/export.js";
import { listenForWebhooks } from "./commands/webhooks.js";

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new InvalidArgumentError("must be an integer between 0 and 65535");
  }
  return port;
}

function parsePositiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return parsed;
}

/** Appends the api's own explanation (e.g. validation messages) to a failed request's error. */
function describeError(err: unknown): string {
  if (err instanceof StellarLensApiError) {
    const body = err.body as { message?: unknown } | undefined;
    const detail = Array.isArray(body?.message) ? body.message.join("; ") : body?.message;
    return typeof detail === "string" && detail.length > 0 ? `${err.message}: ${detail}` : err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

function parseContractId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    throw new InvalidArgumentError("must be a positive integer contract id");
  }
  return id;
}

const program = new Command();

program
  .name("stellarlens")
  .description(
    "CLI for the stellarlens Soroban indexing platform. Commands that call the api require STELLARLENS_API_URL and STELLARLENS_API_KEY."
  )
  .version("0.1.0");

const contractsCommand = program.command("contracts").description("Manage registered contracts");

contractsCommand
  .command("add <address>")
  .description("Register a contract")
  .requiredOption("-n, --network <network>", "Stellar network, e.g. testnet")
  .option("--name <name>", "Optional display name")
  .action(async (address: string, options: { network: string; name?: string }) => {
    await addContract(createClientFromEnv(), address, options);
  });

contractsCommand
  .command("list")
  .description("List registered contracts")
  .action(async () => {
    await listContracts(createClientFromEnv());
  });

const eventsCommand = program.command("events").description("Work with indexed contract events");

eventsCommand
  .command("list")
  .description("List a page of a contract's events, oldest first")
  .addArgument(new Argument("<contractId>", "Contract id").argParser(parseContractId))
  .option("-l, --limit <n>", "Events per page (1-100)", parsePositiveInt)
  .option("-c, --cursor <id>", "Only events after this event id (from a previous page)", parsePositiveInt)
  .option("--topic <topic>", "Only events whose decoded topic contains this value")
  .option("--from <date>", "Only events created at or after this ISO-8601 date/time")
  .option("--to <date>", "Only events created at or before this ISO-8601 date/time")
  .action(
    async (
      contractId: number,
      options: { limit?: number; cursor?: number; topic?: string; from?: string; to?: string }
    ) => {
      await listEvents(createClientFromEnv(), contractId, options);
    }
  );

eventsCommand
  .command("tail <contractId>")
  .description("Follow new events for a contract in real time")
  .action(async (contractId: string) => {
    await tailEvents(createClientFromEnv(), Number(contractId));
  });

program
  .command("export")
  .description("Bulk-export a contract's events or transfers to a file, resumably")
  .addArgument(new Argument("<kind>", "What to export").choices(["events", "transfers"]))
  .addArgument(new Argument("<contractId>", "Contract id").argParser(parseContractId))
  .addOption(new Option("-f, --format <format>", "Output format").choices(["csv", "ndjson"]).default("csv"))
  .requiredOption("-o, --out <file>", "File to write (a <file>.cursor.json checkpoint is kept next to it)")
  .option("--from <date>", "Only records created at or after this ISO-8601 date/time")
  .option("--to <date>", "Only records created at or before this ISO-8601 date/time")
  .option("--resume", "Continue from the last checkpointed cursor instead of starting over")
  .action(
    async (
      kind: ExportKind,
      contractId: number,
      options: { format: ExportFormat; out: string; from?: string; to?: string; resume?: boolean }
    ) => {
      await runExport(createClientFromEnv(), kind, contractId, options);
    }
  );

program
  .command("decode [xdr]")
  .description("Decode base64 ScVal XDR (from the argument, or stdin) using the indexer's decoding rules")
  .action(async (xdr: string | undefined) => {
    await runDecode(xdr);
  });

const webhooksCommand = program.command("webhooks").description("Develop webhook consumers locally");

webhooksCommand
  .command("listen")
  .description("Run a local receiver that verifies and pretty-prints webhook deliveries")
  .option("-p, --port <port>", "Port to listen on", parsePort, 4000)
  .option("--host <host>", "Interface to bind to", "127.0.0.1")
  .addOption(
    new Option("-s, --secret <secret>", "The webhook's signing secret")
      .env("STELLARLENS_WEBHOOK_SECRET")
      .makeOptionMandatory()
  )
  .option("--forward-to <url>", "Re-POST verified payloads to this url (e.g. your local app)")
  .action(async (options: { port: number; host: string; secret: string; forwardTo?: string }) => {
    await listenForWebhooks(options);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`error: ${describeError(err)}`);
  process.exitCode = 1;
});
