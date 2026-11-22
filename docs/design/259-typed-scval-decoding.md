# #259: Optional typed decoding that keeps ScVal type tags

## Problem

`decodeScVal` in [`packages/decode/src/index.ts`](../../packages/decode/src/index.ts) (the issue's
`apps/indexer/src/decode.ts` has since moved here) is `toJsonSafe(scValToNative(scVal))`. That gives
readable JSON but discards the type:

| ScVal | `decoded` today | Can't be told apart from |
| --- | --- | --- |
| `Symbol("transfer")` | `"transfer"` | `String("transfer")` |
| `String("transfer")` | `"transfer"` | `Symbol` |
| `Address(G…/C…)` | `"G…"` / `"C…"` | any string |
| `Bytes` / `BytesN` | `"00ff…"` (hex) | any string |
| `U32(5)` / `I32(5)` | `5` | each other |
| `U64` / `I64` / `U128` / `I128` / `U256` / `I256` | `"5"` | each other, strings |
| `Timepoint` / `Duration` | `"5"` | the integers above |
| `Void` | `null` | a failed decode (also `null`) |
| `Map` | `{ … }` | non-symbol keys get stringified, and order is lost |

## Design

### Shape

Add a `typed` tree to `decoded_data`, **next to** the existing `decoded`. `decoded` stays unchanged
for compatibility.

```jsonc
"decoded_data": {
  "decoded": { "topic": ["transfer", "G…", "C…"], "value": "1000" },
  "typed": {
    "topic": [
      { "type": "symbol", "value": "transfer" },
      { "type": "address", "value": "G…", "kind": "account" },
      { "type": "address", "value": "C…", "kind": "contract" }
    ],
    "value": { "type": "i128", "value": "1000" }
  }
}
```

A `TypedScVal` is a discriminated union on `type`. Every node is JSON-safe (no `bigint`, no `Buffer`):

| `type` | `value` | Notes |
| --- | --- | --- |
| `bool` | `boolean` | |
| `void` | `null` | |
| `u32`, `i32` | `number` | fits in a JS number |
| `u64`, `i64`, `u128`, `i128`, `u256`, `i256` | `string` | decimal |
| `timepoint`, `duration` | `string` | decimal seconds |
| `bytes` | `string` | hex, the same as `decoded` |
| `string` | `string` | UTF-8. Invalid UTF-8 → hex plus `"encoding": "hex"` |
| `symbol` | `string` | |
| `address` | `string` | strkey, plus `kind`: `"account" \| "contract" \| "muxed_account" \| "claimable_balance" \| "liquidity_pool"` |
| `vec` | `TypedScVal[]` | `null` vec → `{ "type": "vec", "value": null }` |
| `map` | `{ key: TypedScVal, value: TypedScVal }[]` | **array of entries**, so key types and order are kept |
| `error` | `{ type: string, code: number \| string }` | contract error code, or the error type name + code |
| `contract_instance`, `ledger_key_contract_instance`, `ledger_key_nonce` | `{ … }` | rare in events. A minimal object or the base64 XDR is fine; just don't throw |

Use the variant names, lowercased, as the canonical source for the `type` strings, so anyone who knows
`xdr.ScValType` can map between them.

### Implementation

Add the function to the decode package. Write it by hand; don't post-process `scValToNative`. It
switches on `scVal.switch().name` and recurses for `vec` and `map`.

```ts
export type TypedScVal =
  | { type: "bool"; value: boolean }
  | { type: "void"; value: null }
  | { type: "u32" | "i32"; value: number }
  | { type: "u64" | "i64" | "u128" | "i128" | "u256" | "i256" | "timepoint" | "duration"; value: string }
  | { type: "bytes" | "symbol"; value: string }
  | { type: "string"; value: string; encoding?: "hex" }
  | { type: "address"; value: string; kind: AddressKind }
  | { type: "vec"; value: TypedScVal[] | null }
  | { type: "map"; value: { key: TypedScVal; value: TypedScVal }[] | null }
  | { type: "error"; value: { type: string; code: number | string } }
  | { type: "contract_instance" | "ledger_key_contract_instance" | "ledger_key_nonce"; value: unknown };

export function decodeScValTyped(base64Xdr: string): TypedScVal;
export function tryDecodeScValTyped(base64Xdr: string): TypedDecodeResult; // mirrors tryDecodeScVal
```

For big integers, `scValToBigInt(scVal).toString()` handles every 64/128/256-bit case. For addresses,
use `Address.fromScVal(scVal).toString()` and derive `kind` from the `ScAddress` arm.

### Indexer

In `decodeEventPayload` ([`apps/indexer/src/events.ts`](../../apps/indexer/src/events.ts)), parse each
XDR once and produce both forms. Store them as `decodedData.typed = { topic, value }`.

- A field that fails to decode is `null` in `typed`, the same as in `decoded`, and gets **one**
  `decodeErrors` entry, not two.
- Webhook payloads: leave them unchanged in this issue. Adding `typed` there is a separate decision
  (payload size, `version: 2`).
- `detectTransfer` keeps working on `decoded`. A follow-up could tighten it to require
  `symbol`/`address` tags using `typed`.

### "Optional"

The issue says "optional". Read that as *optional for consumers*: the field is always written for
new events, and existing rows simply don't have it. Don't add a config flag. It doubles the
code paths for a small storage saving.

Existing rows **aren't backfilled** by this issue. They still have `raw.topic` and `raw.value`, so a
one-off script can fill `typed` later if needed. API consumers must treat `typed` as possibly absent.

### API and SDK types

`DecodedEventData` is defined in [`apps/api/openapi.json`](../../apps/api/openapi.json). The SDK's
[`types.ts`](../../packages/sdk/src/types.ts) derives from the generated file and must not be
hand-edited.

1. In `openapi.json`, add a `TypedScVal` schema as a `oneOf` with a `discriminator` on `type`
   (recursive `$ref` for `vec`/`map`), and an **optional** `typed: { topic: (TypedScVal|null)[], value: TypedScVal|null }`
   on `DecodedEventData`.
2. Run `pnpm --filter @stellarlens/sdk generate`, and commit `src/generated/openapi.ts`.
3. In `types.ts`, add `export type TypedScVal = Schemas["TypedScVal"];` and re-export it from `index.ts`.
4. Check that `openapi-typescript` produces a usable discriminated union. If the recursive `oneOf`
   comes out as `unknown`, export the hand-written type from `@stellarlens/decode` and add a
   compile-time assertion in `types.ts` (like `_GeneratedPagesMatch`) so the two can't drift.

## Tests

[`packages/decode/src/index.test.ts`](../../packages/decode/src/index.test.ts): one test per row of the
shape table. Build inputs with `xdr.ScVal.scv*` constructors so the tag is exact:

- `bool` true/false, `void`
- `u32`, `i32` (including negative), and `u64`, `i64`, `u128`, `i128`, `u256`, `i256` at their max and
  min values. Assert the value is a `string` with no precision loss
- `timepoint`, `duration`
- `bytes` (empty, and 32 bytes), `string` (ASCII, multibyte UTF-8, invalid UTF-8), `symbol`
- `symbol` and `string` with the same text decode to **different** `type`s (the core regression)
- `address`: account (G…), contract (C…), and muxed if the SDK version supports it
- `vec` (empty, nested, `null`) and `map` (symbol keys, **non-symbol keys** such as `u32` and `address`,
  order preserved)
- `error` (contract error and a non-contract error type)
- the `ledger_key_*` and `contract_instance` variants don't throw
- `tryDecodeScValTyped` returns `{ ok: false }` on the existing `MALFORMED_XDR`

To guarantee coverage, add a test that loops over every `xdr.ScValType` member and checks the switch handles it:

```ts
it("handles every ScValType", () => {
  for (const { name } of xdr.ScValType.values()) expect(SAMPLES[name]).toBeDefined();
});
```

[`apps/indexer/test/events.test.ts`](../../apps/indexer/test/events.test.ts): an indexed SEP-41
transfer stores `decodedData.typed.topic` as `[symbol, address, address]` and `typed.value` as `i128`.
A malformed field gives `null` in both trees and a single `decodeErrors` entry.

## Acceptance checklist

- [ ] `decoded_data.typed` written alongside `decoded` for new events
- [ ] `TypedScVal` in the OpenAPI spec, SDK regenerated, type exported
- [ ] Decoder tests cover every ScVal variant (with the exhaustiveness guard)
