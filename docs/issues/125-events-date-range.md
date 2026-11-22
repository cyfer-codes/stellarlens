# #125: Add `--from`/`--to` date-range options to `events` commands

**Area:** cli · **Complexity:** trivial

## Problem

The api already accepts `from`/`to` (ISO 8601) on `GET /contracts/:id/events`, and the SDK's
`ListEventsParams` passes them through. The CLI doesn't expose them consistently on the `events`
commands.

## Current state

- **`events list`** already has `--from <date>` / `--to <date>` in
  [`index.ts`](../../packages/cli/src/index.ts), and `listEvents` in
  [`commands/events.ts`](../../packages/cli/src/commands/events.ts) forwards them to
  `client.listEvents`. **What's missing for this command is a test.**
- **`events tail`** has `--since <cursor|iso-date>` and `--from-start`, but no `--to`. It also can't
  apply `from`/`to` to each poll.

> **Heads-up:** `commands/events.ts` and `index.ts` currently contain spliced, duplicate definitions:
> three `tailEvents` functions and two `events tail` action chains. They look like bad merge
> resolutions. Settle on one `tailEvents` implementation before adding options, or the new flags will
> be wired to code that never runs.

## Behaviour

### `events list`

```sh
stellarlens events list 12 --from 2026-11-01T00:00:00Z --to 2026-11-02T00:00:00Z
```

- Both flags are optional and independent. They're sent to the SDK unchanged as `from` / `to`.
- If both are omitted, neither key is sent and the output stays unscoped, as it is today.
- Validation, such as `from` after `to`, is left to the api, which already rejects it with `400`. The
  CLI prints the api's message through `describeError`.

### `events tail`

```sh
stellarlens events tail 12 --from 2026-11-01T00:00:00Z
stellarlens events tail 12 --from 2026-11-01T00:00:00Z --to 2026-11-01T12:00:00Z
```

- `--from <date>` is the same as `--since <iso-date>` and uses the existing `resolveStartCursor` date
  logic. It conflicts with `--since` and `--from-start`, so use commander's `.conflicts()` as the
  existing options do.
- `--to <date>` is passed as `to` on every poll. Once a poll returns no events and the current time is
  past `to`, the tail prints `reached --to <date>` and exits 0. Without this it would keep polling
  forever for events that can never arrive.
- If both are omitted, behaviour doesn't change.

## Implementation

1. In `index.ts`, add `--from` / `--to` to `events tail`.
2. Extend `TailOptions` with `to?: string`, and map `from` onto the existing `since` date path.
3. Pass `to` into each `client.listEvents(...)` call made while tailing.

## Tests

Add a CLI unit test with a mocked `StellarLensClient` (`listEvents: vi.fn()`), in
`packages/cli/src/commands/events.test.ts` or next to the existing CLI tests:

| Case | Asserts |
| --- | --- |
| `listEvents` with both | `client.listEvents` called with `expect.objectContaining({ from, to })`. |
| `listEvents` with neither | The call's params have `from` and `to` as `undefined`. |
| `tailEvents` with `to` | Every poll's params include `to`. The loop ends once caught up and past `to`. |
| `--from` + `--since` | Rejected before any request is sent. |
