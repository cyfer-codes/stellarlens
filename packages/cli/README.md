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
