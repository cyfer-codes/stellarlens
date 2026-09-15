#!/usr/bin/env node
import { Command } from "commander";
import { createClientFromEnv } from "./client.js";
import { addContract, listContracts } from "./commands/contracts.js";
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
  .command("tail <contractId>")
  .description("Follow new events for a contract in real time")
  .action(async (contractId: string) => {
    await tailEvents(createClientFromEnv(), Number(contractId));
  });

program.parseAsync(process.argv);
