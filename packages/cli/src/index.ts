#!/usr/bin/env node
import { Command } from "commander";
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

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
