#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { createClientFromEnv } from "./client.js";
import { addContract, listContracts } from "./commands/contracts.js";
import { DEFAULT_POLL_INTERVAL_MS, tailEvents } from "./commands/events.js";

function parsePageSize(value: string): number {
  const size = Number(value);
  if (!Number.isInteger(size) || size < 1 || size > 100) {
    throw new InvalidArgumentError("must be an integer between 1 and 100");
  }
  return size;
}

function parsePositiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return n;
}

const program = new Command();

program
  .name("stellarlens")
  .description(
    "CLI for the stellarlens Soroban indexing platform. Requires STELLARLENS_API_URL and STELLARLENS_API_KEY."
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

program.parseAsync(process.argv);
