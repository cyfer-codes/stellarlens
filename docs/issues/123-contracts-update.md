# #123: Add `stellarlens contracts update <id>`

**Area:** cli, sdk · **Complexity:** medium · **Depends on:** SDK `updateContract`

## Problem

You can't rename a registered contract from the CLI. The api already supports it:
`PATCH /contracts/:id` in
[`contracts.controller.ts`](../../apps/api/src/contracts/contracts.controller.ts) takes an
`UpdateContractDto` with `name?: string | null` and `network?`. **The SDK has no `updateContract`
method yet**, so that has to come first.

## Usage

```sh
stellarlens contracts update 12 --name "USDC (testnet)"
# ✓ updated contract 12
# id:      12
# address: CDLZ…
# name:    USDC (testnet)
# network: testnet

stellarlens contracts update 12
# error: nothing to update: pass --name <name>
# (exit code 1, no request sent)

stellarlens contracts update 999 --name x
# error: contract 999 not found
# (exit code 1)
```

With the global `--json` flag, the command prints the updated contract as one JSON object.

## Prerequisite: SDK method

Add to [`packages/sdk/src/client.ts`](../../packages/sdk/src/client.ts), next to `deleteContract`:

```ts
export interface UpdateContractInput {
  name?: string | null;
}

/** Updates a registered contract (`PATCH /contracts/:id`) and returns it. 404 rejects with StellarLensApiError. */
async updateContract(id: number, input: UpdateContractInput, options?: RequestOptions): Promise<Contract> {
  return this.request<Contract>(
    `/contracts/${id}`,
    { method: "PATCH", body: JSON.stringify(input), headers: { "content-type": "application/json" } },
    options
  );
}
```

Follow how `registerContract` builds its request. Add an SDK test that asserts the method is `PATCH`,
the path, and the JSON body.

## CLI implementation

**[`commands/contracts.ts`](../../packages/cli/src/commands/contracts.ts):** add an `updateContract`
function.

```ts
export async function updateContract(
  client: StellarLensClient,
  id: number,
  options: { name?: string; json?: boolean }
): Promise<void>
```

1. If `options.name === undefined`, throw `new Error("nothing to update: pass --name <name>")`. Do this
   before calling the SDK, so an empty `{}` PATCH is never sent.
2. Call `client.updateContract(id, { name: options.name })`.
3. If the api returns a 404 `StellarLensApiError`, throw `contract ${id} not found`, the same way
   `getContract` does.
4. Print the result in the same field layout as `getContract`, or as JSON when `json` is set.

**[`index.ts`](../../packages/cli/src/index.ts):** register the subcommand.

```ts
contractsCommand
  .command("update")
  .description("Rename a registered contract")
  .addArgument(new Argument("<id>", "Contract id").argParser(parseContractId))
  .option("--name <name>", "New display name")
  .action(async (id: number, options: { name?: string }) => {
    await updateContract(createClientFromEnv(), id, { ...options, json: jsonOutput() });
  });
```

Leave out a separate `--clear-name` flag for now. `--name ""` is sent as `""`, and whether that counts
as valid is up to the api's validation.

> **Heads-up:** `index.ts` currently has duplicate import blocks and spliced command definitions.
> Clean these up before adding to them, or the new command won't compile.

## Tests

| Case | Asserts |
| --- | --- |
| success | `client.updateContract` called with `(12, { name: "new" })`. The printed output contains the new name. |
| missing `--name` | Rejects with the usage error. `client.updateContract` is not called. |
| not found (optional but recommended) | A 404 `StellarLensApiError` becomes `contract 12 not found`. |
