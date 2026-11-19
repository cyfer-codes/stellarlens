#!/usr/bin/env node
import { Command, InvalidArgumentError, Option } from "commander";
import { createClientFromEnv } from "./client.js";
import { addContract, listContracts } from "./commands/contracts.js";
import { tailEvents } from "./commands/events.js";
import { listenForWebhooks } from "./commands/webhooks.js";

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new InvalidArgumentError("must be an integer between 0 and 65535");
  }
  return port;
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
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
