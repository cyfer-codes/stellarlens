# @stellarlens/cli

Command-line client for the stellarlens api, built on [`@stellarlens/sdk`](../sdk).

## Setup

```bash
export STELLARLENS_API_URL=https://your-stellarlens-deployment.com
export STELLARLENS_API_KEY=<a valid api key>
```

## Usage

```bash
stellarlens contracts add <address> --network testnet [--name "My contract"]
stellarlens contracts list                   # every contract, across all pages
stellarlens events list <contractId> [--limit 20] [--cursor <id>] [--topic t] [--from d] [--to d]
stellarlens events tail <contractId>   # follows new events every 5s, ctrl+c to stop
```

### Decoding XDR

```bash
stellarlens decode AAAACgAAAAAAAAAAAAAAAAAAAAU=      # prints "5"
echo AAAACgAAAAAAAAAAAAAAAAAAAAU= | stellarlens decode
```

Decodes a base64 `ScVal` (an event topic or value from RPC or an explorer) into JSON using the exact rules the
indexer stores events with (`@stellarlens/decode`): `i128`/`u64` etc. become strings, maps become objects.
Invalid XDR prints `error: invalid XDR: <reason>` and exits with status 1. Needs no api credentials.

### Bulk export

```bash
stellarlens export events <contractId> --format csv --out events.csv [--from 2026-01-01 --to 2026-02-01]
stellarlens export transfers <contractId> --format ndjson --out transfers.ndjson
stellarlens export events <contractId> --format csv --out events.csv --resume
```

Streams every page to the file, fetching the next page only after the previous one is written. After each
page the cursor is checkpointed to `<out>.cursor.json`; `--resume` continues from there (dropping any
half-written page first), and resuming a finished export appends only records indexed since. CSV cells use
the same escaping as the dashboard export, including formula-injection protection. Events use fixed columns
with the decoded `topic`/`value` as JSON. Transfers are filtered by `--from`/`--to` client-side, because the
transfers endpoint's `from`/`to` filter on addresses.

### Developing a webhook consumer locally

```bash
stellarlens webhooks listen --port 4000 --secret <webhook secret> [--forward-to http://localhost:3001/webhook]
```

Starts a local HTTP server (bound to `127.0.0.1`; pass `--host` to change it) that checks each delivery's
`X-Webhook-Signature` with the SDK's `verifyWebhookSignature`, then pretty-prints the payload with a
`✔ VALID` / `✘ INVALID` marker. Invalid deliveries are answered with `401`. With `--forward-to`, verified
payloads are re-POSTed byte-for-byte (signature header included) to your app, and the app's status code is
passed back to the sender. The secret can also come from `STELLARLENS_WEBHOOK_SECRET`.
stellarlens contracts add <address...> --network testnet [--name "My contract"]
stellarlens contracts add --file contracts.txt|contracts.json [--network testnet]
stellarlens contracts list
stellarlens events tail <contractId>   # follows new events every 5s, ctrl+c to stop
```

### Registering many contracts

`contracts add` takes any number of addresses, and/or `--file`:

```bash
stellarlens contracts add CAAA... CBBB... GCCC... --network testnet
stellarlens contracts add --file contracts.txt --network testnet
stellarlens contracts add --file contracts.json            # networks set per entry
```

- **Text files**: one address per line; blank lines and `#` comments are ignored. `--network` applies to all.
- **JSON files**: an array (or `{ "items": [...] }`, the same body as `POST /contracts/bulk`) of address
  strings or `{ "address", "network"?, "name"? }` objects. `--network` is the default for entries without one.

Every address is checked locally as a well-formed contract (`C...`) or account (`G...`) strkey before
anything is sent, and each address gets its own result line: `created`, `existing` (already registered,
left untouched), `registered` (single-contract endpoint, which upserts), `skipped` (duplicate in the
input), `invalid` or `failed`. Several addresses are sent to `POST /contracts/bulk` in chunks of 100;
against an api without that endpoint (404/405) the CLI falls back to one `POST /contracts` per address.
`--name` is only accepted with a single address.

The command exits with status `1` if any address is invalid or failed to register, so it's safe to use
in scripts and CI.

Run `stellarlens --help` (or `--help` on any subcommand) for full option details.
