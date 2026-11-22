# Issue #120 — Add a build smoke test covering both ESM and CJS outputs

**Complexity:** medium  
**Files:** `packages/sdk/tsup.config.ts`, `packages/sdk/package.json`

## Background

`tsup.config.ts` already emits both `dist/index.js` (ESM) and `dist/index.cjs` (CJS), but nothing
in CI actually imports them. A build misconfiguration — a wrong `exports` map, a missing
`"type": "module"` guard, a tsup entry path change — could silently break one format while the
other continues to pass the unit tests.

## What to implement

Add a small smoke-test script that runs against the **built** `dist/` output, not the TypeScript
source, so it catches build-configuration regressions that the unit tests would miss.

### 1. Create the smoke test script

Add `packages/sdk/test/smoke.mjs` (native ESM, so `.mjs` even though the package is `"type":
"module"` — this avoids any ambiguity):

```js
// packages/sdk/test/smoke.mjs
// Run after `pnpm build` — tests that both dist entry points are importable.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ── ESM ──────────────────────────────────────────────────────────────────────
const esm = await import(path.join(__dirname, "../dist/index.js"));

assert.ok(typeof esm.StellarLensClient === "function", "ESM: StellarLensClient must be a constructor");
assert.ok(typeof esm.StellarLensApiError === "function", "ESM: StellarLensApiError must be a constructor");

// A minimal instantiation — exercises the exports map, not API calls.
const esmClient = new esm.StellarLensClient({
  baseUrl: "https://example.invalid",
  apiKey: "smoke-test",
});
assert.ok(esmClient, "ESM: StellarLensClient instantiates without error");

// ── CJS ──────────────────────────────────────────────────────────────────────
const cjs = require(path.join(__dirname, "../dist/index.cjs"));

assert.ok(typeof cjs.StellarLensClient === "function", "CJS: StellarLensClient must be a constructor");
assert.ok(typeof cjs.StellarLensApiError === "function", "CJS: StellarLensApiError must be a constructor");

const cjsClient = new cjs.StellarLensClient({
  baseUrl: "https://example.invalid",
  apiKey: "smoke-test",
});
assert.ok(cjsClient, "CJS: StellarLensClient instantiates without error");

console.log("✓ ESM and CJS smoke tests passed");
```

### 2. Add a `test:smoke` script to `packages/sdk/package.json`

```json
"scripts": {
  "build": "tsup",
  "dev": "tsup --watch",
  "lint": "eslint .",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:smoke": "node test/smoke.mjs",
  "generate": "openapi-typescript ../../apps/api/openapi.json --output src/generated/openapi.ts"
}
```

The script is intentionally separate from `test` so the existing Vitest suite is unaffected.
Run it only after a build: `pnpm build && pnpm test:smoke`.

### 3. Add it to the CI workflow

Open `.github/workflows/ci.yml`. After the existing build step for the SDK, add:

```yaml
- name: Smoke-test ESM and CJS outputs
  run: pnpm --filter @stellarlens/sdk test:smoke
```

This ensures CI catches a broken `exports` map before the package is published.

## Running locally

```bash
# From the repo root
pnpm --filter @stellarlens/sdk build
pnpm --filter @stellarlens/sdk test:smoke
```

Expected output:

```
✓ ESM and CJS smoke tests passed
```

A failure prints the failed `assert` message and exits non-zero, which fails the CI step.

## What the test does and does not cover

**Does cover:**
- Both `dist/index.js` and `dist/index.cjs` are present and loadable after a build.
- The `exports` map resolves to the right files for `import` and `require`.
- The main public exports (`StellarLensClient`, `StellarLensApiError`) survive bundling.

**Does not cover:**
- Actual API calls (those belong in unit/integration tests).
- The `./webhooks` sub-path export — extend `smoke.mjs` to cover it once this is merged, or
  include it in the initial implementation for full coverage.

## Acceptance criteria checklist

- [ ] `packages/sdk/test/smoke.mjs` imports `dist/index.js` via `import` and `dist/index.cjs` via `require()`.
- [ ] At least one basic assertion is made against each format (e.g. `StellarLensClient` is a function).
- [ ] The test runs against `dist/`, not `src/`.
- [ ] A `test:smoke` script in `package.json` runs the file with `node`.
- [ ] The CI workflow runs `test:smoke` after the build step.
- [ ] The test script and CI step are documented (e.g. a comment in `ci.yml` or a note in the SDK `README`).
