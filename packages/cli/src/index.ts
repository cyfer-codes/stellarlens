#!/usr/bin/env node
import { Command } from "commander";
import { createClientFromEnv } from "./client.js";
import { addContracts, listContracts } from "./commands/contracts.js";
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
  .description("Register one or more contracts, or read them from a file")
  .requiredOption("-n, --network <network>", "Stellar network, e.g. testnet")
  .option("--name <name>", "Optional display name (for a single contract)")
  .option("-f, --file <file>", "File path containing contract addresses (.txt or .json)")
  .action(
    async (addresses: string[], options: { network: string; name?: string; file?: string }) => {
      const success = await addContracts(createClientFromEnv(), addresses, options);
      if (!success) {
        process.exitCode = 1;
      }
    }
  );

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
