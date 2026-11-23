#!/usr/bin/env node
import { Argument, Command, InvalidArgumentError, Option } from "commander";
import { createClientFromEnv } from "./client.js";
import { StellarLensApiError } from "@stellarlens/sdk";
import {
  type ContractEntry,
  getContract,
  listContracts,
  readContractsFile,
  runAddContracts
} from "./commands/contracts.js";
import { runDecode } from "./commands/decode.js";
import { DEFAULT_POLL_INTERVAL_MS, listEvents, tailEvents } from "./commands/events.js";
import { runExport, type ExportFormat, type ExportKind } from "./commands/export.js";
import { showStats } from "./commands/stats.js";
import { listTransfers } from "./commands/transfers.js";
import { addWebhook, listenForWebhooks, listWebhooks, removeWebhook } from "./commands/webhooks.js";

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
  .version("0.1.0")
  .option("--json", "Print machine-readable JSON instead of formatted output");

/** Whether the global `--json` flag was passed. */
function jsonOutput(): boolean {
  return program.opts<{ json?: boolean }>().json === true;
}

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
        name: options.name,
        json: jsonOutput()
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
  .option("--page-size <size>", "Contracts fetched per api request (1-100)", parsePositiveInt, 100)
  .action(async (options: { name?: string; network?: string; pageSize: number }) => {
    await listContracts(createClientFromEnv(), { ...options, json: jsonOutput() });
  });

contractsCommand
  .command("get")
  .description("Show a single registered contract by id")
  .addArgument(new Argument("<id>", "Contract id").argParser(parseContractId))
  .action(async (id: number) => {
    await getContract(createClientFromEnv(), id);
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
  .option("--latest", "Skip existing events and only show ones indexed from now on")
  .option("--interval <ms>", "Poll interval in milliseconds", parsePositiveInt, DEFAULT_POLL_INTERVAL_MS)
  .action(async (contractId: string, options: { latest?: boolean; interval: number }) => {
    const controller = new AbortController();
    process.once("SIGINT", () => controller.abort());
    await tailEvents(createClientFromEnv(), Number(contractId), {
      latest: options.latest,
      intervalMs: options.interval,
      signal: controller.signal,
      json: jsonOutput()
    });
  });

const transfersCommand = program.command("transfers").description("Work with indexed token transfers");

transfersCommand
  .command("list")
  .description("List a page of a contract's transfers, oldest first")
  .addArgument(new Argument("<contractId>", "Contract id").argParser(parseContractId))
  .option("-l, --limit <n>", "Transfers per page (1-100)", parsePositiveInt)
  .option("-c, --cursor <id>", "Only transfers after this transfer id (from a previous page)", parsePositiveInt)
  .action(async (contractId: number, options: { limit?: number; cursor?: number }) => {
    await listTransfers(createClientFromEnv(), contractId, options);
  });

program
  .command("stats")
  .description("Show a contract's transfer stats: count, unique senders/receivers and volume by asset")
  .addArgument(new Argument("<contractId>", "Contract id").argParser(parseContractId))
  .option("--from <date>", "Only transfers created at or after this ISO-8601 date/time")
  .option("--to <date>", "Only transfers created at or before this ISO-8601 date/time")
  .action(async (contractId: number, options: { from?: string; to?: string }) => {
    await showStats(createClientFromEnv(), contractId, options);
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

const webhooksCommand = program
  .command("webhooks")
  .description("Manage a contract's webhooks and develop webhook consumers locally");

webhooksCommand
  .command("add")
  .description("Register a webhook for a contract and print its one-time signing secret")
  .addArgument(new Argument("<contractId>", "Contract id").argParser(parseContractId))
  .argument("<url>", "Url the indexer POSTs deliveries to")
  .option(
    "-e, --event-types <topics>",
    "Comma-separated event topics to deliver (default: all)",
    (value: string) => value.split(",").map((topic) => topic.trim()).filter((topic) => topic.length > 0)
  )
  .action(async (contractId: number, url: string, options: { eventTypes?: string[] }) => {
    await addWebhook(createClientFromEnv(), contractId, url, options);
  });

webhooksCommand
  .command("list")
  .description("List the webhooks registered for a contract")
  .addArgument(new Argument("<contractId>", "Contract id").argParser(parseContractId))
  .action(async (contractId: number) => {
    await listWebhooks(createClientFromEnv(), contractId);
  });

webhooksCommand
  .command("remove")
  .description("Delete a webhook from a contract")
  .addArgument(new Argument("<contractId>", "Contract id").argParser(parseContractId))
  .addArgument(new Argument("<id>", "Webhook id").argParser(parsePositiveInt))
  .action(async (contractId: number, id: number) => {
    await removeWebhook(createClientFromEnv(), contractId, id);
  });

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

// Shell completion (issue #129)
program
  .command("completion <shell>")
  .description("Print a sourceable shell completion script for bash or zsh")
  .action((shell: string) => {
    if (shell !== "bash" && shell !== "zsh") {
      console.error(`Unsupported shell: ${shell}. Supported: bash, zsh`);
      process.exitCode = 1;
      return;
    }

    const topLevel = program.commands
      .map((c) => c.name())
      .filter((name) => name !== "completion");

    if (shell === "bash") {
      console.log(`# stellarlens bash completion
# Add to ~/.bashrc or ~/.bash_profile:
#   source <(stellarlens completion bash)

_stellarlens_completion() {
  local cur prev words cword
  _init_completion 2>/dev/null || {
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
  }

  local commands="${topLevel.join(" ")}"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
    return
  fi

  case "\${COMP_WORDS[1]}" in
    contracts)
      COMPREPLY=( $(compgen -W "add list get" -- "\${cur}") )
      ;;
    events)
      COMPREPLY=( $(compgen -W "list tail" -- "\${cur}") )
      ;;
    transfers)
      COMPREPLY=( $(compgen -W "list" -- "\${cur}") )
      ;;
    webhooks)
      COMPREPLY=( $(compgen -W "add list remove listen" -- "\${cur}") )
      ;;
    export)
      COMPREPLY=( $(compgen -W "events transfers" -- "\${cur}") )
      ;;
    *)
      COMPREPLY=()
      ;;
  esac
}

complete -F _stellarlens_completion stellarlens`);
    } else {
      // zsh
      console.log(`#compdef stellarlens
# stellarlens zsh completion
# Add to your ~/.zshrc:
#   source <(stellarlens completion zsh)

_stellarlens() {
  local -a commands
  commands=(
${topLevel.map((name) => `    '${name}'`).join("\n")}
  )

  local -a contracts_cmds events_cmds transfers_cmds webhooks_cmds
  contracts_cmds=('add' 'list' 'get')
  events_cmds=('list' 'tail')
  transfers_cmds=('list')
  webhooks_cmds=('add' 'list' 'remove' 'listen')

  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi

  case \${words[2]} in
    contracts)
      _describe 'contracts command' contracts_cmds
      ;;
    events)
      _describe 'events command' events_cmds
      ;;
    transfers)
      _describe 'transfers command' transfers_cmds
      ;;
    webhooks)
      _describe 'webhooks command' webhooks_cmds
      ;;
    export)
      local -a export_kinds
      export_kinds=('events' 'transfers')
      _describe 'export kind' export_kinds
      ;;
  esac
}

_stellarlens "\$@"`);
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`error: ${describeError(err)}`);
  process.exitCode = 1;
});
