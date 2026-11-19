# @stellarlens/cli

Command-line client for the stellarlens api, built on [`@stellarlens/sdk`](../sdk).

## Setup

```bash
export STELLARLENS_API_URL=https://your-stellarlens-deployment.com
export STELLARLENS_API_KEY=<a valid api key>
```

## Usage

```bash
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
