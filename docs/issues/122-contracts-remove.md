# #122: Add `stellarlens contracts remove <id>`

**Area:** cli (api) · **Complexity:** medium · **Depends on:** api `DELETE /contracts/:id`

## Problem

The CLI can add, list and get contracts, but it can't deregister one. The SDK already has
`deleteContract(id)` in [`client.ts`](../../packages/sdk/src/client.ts), which sends
`DELETE /contracts/:id` and resolves on `204`.

> **Blocker to check first:** [`contracts.controller.ts`](../../apps/api/src/contracts/contracts.controller.ts)
> currently has no `@Delete(":id")` route, only `POST`, `GET` and `PATCH`. Until the api adds that
> route (seed issue "Add `DELETE /contracts/:id`" in [`seed-issues.md`](../seed-issues.md)), the SDK
> call gets a `404` for every id. Either land the api route first, or ship the CLI command knowing it
> reports "not found" until the route exists.

## Usage

```sh
stellarlens contracts remove 12
# ✓ removed contract 12

stellarlens contracts remove 999
# error: contract 999 not found
# (exit code 1)
```

With the global `--json` flag, the command prints `{"id":12,"removed":true}`.

The command doesn't ask for confirmation, which matches `webhooks remove`. A `--yes`/prompt flow can be
added later if that's wanted.

## CLI implementation

**[`commands/contracts.ts`](../../packages/cli/src/commands/contracts.ts):** add a `removeContract`
function.

```ts
export async function removeContract(
  client: StellarLensClient,
  id: number,
  options: { json?: boolean } = {}
): Promise<void> {
  try {
    await client.deleteContract(id);
  } catch (error) {
    if (error instanceof StellarLensApiError && error.status === 404) {
      throw new Error(`contract ${id} not found`);
    }
    throw error;
  }
  console.log(options.json ? JSON.stringify({ id, removed: true }) : `✓ removed contract ${id}`);
}
```

The thrown `Error` is caught by the top-level `program.parseAsync(...).catch(...)` handler. That handler
prints `error: …` and sets the exit code to 1, so the process never ends with an unhandled rejection.

**[`index.ts`](../../packages/cli/src/index.ts):** register the subcommand.

```ts
contractsCommand
  .command("remove")
  .description("Deregister a contract by id")
  .addArgument(new Argument("<id>", "Contract id").argParser(parseContractId))
  .action(async (id: number) => {
    await removeContract(createClientFromEnv(), id, { json: jsonOutput() });
  });
```

`parseContractId` already rejects ids that aren't positive integers before any request is sent.

> **Heads-up:** `index.ts` and `commands/contracts.ts` currently contain duplicate imports and spliced
> function bodies, including two `fetchAllContracts` and three `listContracts` definitions. Clean these
> up first.

## What deletion means for indexed data

This depends on how the api implements `DELETE`. Once it's decided, document it in the command's
`--help` text:

- whether `events`, `token_transfers` and `webhooks` rows for the contract are cascaded or kept;
- that the indexer stops matching the address on its next poll, because `loadRegisteredContracts` reads
  the `contracts` table on every batch.

## Tests

| Case | Asserts |
| --- | --- |
| success | `client.deleteContract` called with `12`. Prints `removed contract 12`. |
| not found | `deleteContract` rejects with a 404 `StellarLensApiError`. `removeContract` rejects with `contract 12 not found`. |
| other errors pass through | A `500` error is rethrown unchanged, not reported as not-found. |
