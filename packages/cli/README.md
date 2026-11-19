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
stellarlens contracts list
stellarlens events tail <contractId>   # follows new events every 5s, ctrl+c to stop
```

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

Run `stellarlens --help` (or `--help` on any subcommand) for full option details.
