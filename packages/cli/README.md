# @stellarlens/cli

Command-line client for the stellarlens api, built on [`@stellarlens/sdk`](../sdk).

## Setup

```bash
export STELLARLENS_API_URL=https://your-stellarlens-deployment.com
export STELLARLENS_API_KEY=<a valid api key>
```

## Usage

```bash
# Register a single contract
stellarlens contracts add <address> --network testnet [--name "My contract"]

# Register multiple contracts at once
stellarlens contracts add <address1> <address2> <address3> --network testnet

# Register contracts from a file (.txt or .json)
stellarlens contracts add --file contracts.txt --network testnet
stellarlens contracts add --file contracts.json --network testnet

# List registered contracts
stellarlens contracts list

# Follow events in real time
stellarlens events tail <contractId>   # follows new events every 5s, ctrl+c to stop
```

Run `stellarlens --help` (or `--help` on any subcommand) for full option details.
