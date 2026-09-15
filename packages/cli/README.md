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

Run `stellarlens --help` (or `--help` on any subcommand) for full option details.
