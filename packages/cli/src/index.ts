#!/usr/bin/env node
import { Command, Option } from "commander";
import { Command, InvalidArgumentError } from "commander";
import { createClientFromEnv } from "./client.js";
import {
  type ContractEntry,
  listContracts,
  readContractsFile,
  runAddContracts
} from "./commands/contracts.js";
import { tailEvents } from "./commands/events.js";

const program = new Command();

program
  .name("stellarlens")
  .description(
    "CLI for the stellarlens Soroban indexing platform. Requires STELLARLENS_API_URL and STELLARLENS_API_KEY."
  )
  .version("0.1.0");

const contractsCommand = program.command("contracts").description("Manage registered contracts");

contractsCommand
  .command("add [addresses...]")
  .description(
    "Register one or more contracts. Every address is validated locally before anything is sent; " +
      "several addresses use the bulk endpoint when the api supports it. Exits non-zero if any address fails."
  )
  .option("-n, --network <network>", "Stellar network, e.g. testnet (default for file entries without one)")
  .option("--name <name>", "Optional display name (single address only)")
  .option(
    "-f, --file <path>",
    "Read addresses from a file: .json (array of addresses or { address, network?, name? }) or text (one per line, # comments)"
  )
  .action(
    async (addresses: string[], options: { network?: string; name?: string; file?: string }) => {
      const entries: ContractEntry[] = addresses.map((address) => ({ address }));
      if (options.file) {
        entries.push(...(await readContractsFile(options.file)));
      }
      const ok = await runAddContracts(createClientFromEnv(), entries, {
        network: options.network,
        name: options.name
      });
      if (!ok) {
        process.exitCode = 1;
      }
    }
  );

contractsCommand
  .command("list")
  .description("List registered contracts (follows pagination to the end)")
  .option("--name <name>", "Only contracts whose name contains this (case-insensitive)")
  .option("-n, --network <network>", "Only contracts on this network")
  .option("--page-size <size>", "Contracts fetched per api request (1-100)", parsePageSize, 100)
  .action(async (options: { name?: string; network?: string; pageSize: number }) => {
    await listContracts(createClientFromEnv(), options);
  });

const eventsCommand = program.command("events").description("Work with indexed contract events");

eventsCommand
  .command("tail <contractId>")
  .description(
    "Follow new events for a contract in real time. Starts at the latest event by default, so only events " +
      "indexed from now on are shown."
  )
  .addOption(
    new Option(
      "--since <cursor|iso-date>",
      "start after this event id, or from the first event indexed at/after this ISO 8601 date"
    ).conflicts("fromStart")
  )
  .addOption(new Option("--from-start", "replay every event from the beginning of history").conflicts("since"))
  .action(async (contractId: string, options: { since?: string; fromStart?: boolean }) => {
    await tailEvents(createClientFromEnv(), Number(contractId), options);
  .description("Follow new events for a contract in real time")
  .option("--latest", "Skip existing events and only show ones indexed from now on")
  .option("--interval <ms>", "Poll interval in milliseconds", parsePositiveInt, DEFAULT_POLL_INTERVAL_MS)
  .action(async (contractId: string, options: { latest?: boolean; interval: number }) => {
    const controller = new AbortController();
    process.once("SIGINT", () => controller.abort());
    await tailEvents(createClientFromEnv(), Number(contractId), {
      latest: options.latest,
      intervalMs: options.interval,
      signal: controller.signal
    });
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
