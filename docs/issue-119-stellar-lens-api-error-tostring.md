# Issue #119 — Make `StellarLensApiError` log its body readably

**Complexity:** trivial  
**File:** `packages/sdk/src/errors.ts`

## Background

`StellarLensApiError` carries two useful fields — `status` and `body` — but neither appears when
the error is logged with `console.error(err)` or printed as a string. Node prints only the message
and the stack, so callers lose the response body unless they explicitly destructure it.

## Current behaviour

```ts
const err = new StellarLensApiError(422, { message: "Invalid address" });
console.error(err);
// StellarLensApiError: stellarlens api request failed with status 422
//     at ...stack...
// ← status and body are invisible
```

## What to implement

Add a `toJSON` method and a Node.js `util.inspect.custom` symbol to `StellarLensApiError` in
`packages/sdk/src/errors.ts`. Neither changes `message`, `name`, or `stack`.

```ts
import { inspect } from "node:util";

export class StellarLensApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly existingId?: number;

  constructor(status: number, body: unknown) {
    super(`stellarlens api request failed with status ${status}`);
    this.name = "StellarLensApiError";
    this.status = status;
    this.body = body;
    if (
      status === 409 &&
      typeof body === "object" &&
      body !== null &&
      "existingId" in body
    ) {
      const existingId = (body as { existingId?: unknown }).existingId;
      if (typeof existingId === "number") this.existingId = existingId;
    }
  }

  /** Returns a plain object for JSON.stringify and structured loggers. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      body: this.body,
    };
  }

  /** Makes console.error / util.inspect show status and body in Node. */
  [inspect.custom](): string {
    return `${this.name} [${this.status}]: ${this.message}\nbody: ${JSON.stringify(this.body, null, 2)}`;
  }
}
```

### Why both?

- `toJSON` is consumed by `JSON.stringify`, structured loggers (Pino, Winston), and any caller that
  calls `.toJSON()` explicitly.
- `inspect.custom` is used by Node's `util.inspect`, which is what `console.error` and `console.log`
  use under the hood. Without it, `console.error(err)` still falls back to the default Error
  formatting.

### Browser / edge environments

`node:util` does not exist in browser or Cloudflare Workers runtimes. Guard the import so the
SDK stays environment-neutral:

```ts
// At module level, resolved once at import time
const customInspect: symbol | undefined =
  typeof process !== "undefined"
    ? (() => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          return (require("node:util") as { inspect: { custom: symbol } }).inspect.custom;
        } catch {
          return undefined;
        }
      })()
    : undefined;
```

Then define the method conditionally:

```ts
if (customInspect) {
  StellarLensApiError.prototype[customInspect] = function (this: StellarLensApiError): string {
    return `${this.name} [${this.status}]: ${this.message}\nbody: ${JSON.stringify(this.body, null, 2)}`;
  };
}
```

Alternatively, if the project's bundler already tree-shakes `node:util` for non-Node targets
(tsup does in ESM mode), a direct top-level `import { inspect } from "node:util"` is acceptable —
confirm with the existing build output before choosing.

## Tests

Add a test in the SDK test suite (Vitest):

```ts
import { describe, it, expect } from "vitest";
import { StellarLensApiError } from "../src/errors.js";

describe("StellarLensApiError", () => {
  it("toJSON includes status and body", () => {
    const body = { message: "Invalid address" };
    const err = new StellarLensApiError(422, body);
    const json = err.toJSON();
    expect(json.status).toBe(422);
    expect(json.body).toEqual(body);
    expect(json.name).toBe("StellarLensApiError");
    expect(typeof json.message).toBe("string");
  });

  it("does not change message, name, or stack", () => {
    const err = new StellarLensApiError(500, null);
    expect(err.message).toBe("stellarlens api request failed with status 500");
    expect(err.name).toBe("StellarLensApiError");
    expect(typeof err.stack).toBe("string");
  });
});
```

## Acceptance criteria checklist

- [ ] `toJSON()` on a `StellarLensApiError` instance returns an object containing `status` and `body`.
- [ ] `util.inspect(err)` (or `console.error(err)`) in Node shows the status and body.
- [ ] `err.message`, `err.name`, and `err.stack` are unchanged by the addition.
- [ ] A test asserts that `toJSON()` includes `status` and `body`.
