# Issue #116 — Add a `files` field to `packages/sdk/package.json`

**Complexity:** trivial  
**File:** `packages/sdk/package.json`

## Status

Already resolved. `packages/sdk/package.json` contains:

```json
"files": [
  "dist",
  "CHANGELOG.md"
]
```

This restricts the npm tarball to `dist/` and `CHANGELOG.md`. `package.json` and `README.md` are
always included by npm regardless of the `files` field, so they do not need to be listed
explicitly.

## What the field does

When `files` is present, npm includes only the listed paths (plus the always-included files:
`package.json`, `README`, `LICENSE`, and `CHANGELOG` at the package root). Without it, npm falls
back to `.npmignore`, then to `.gitignore`, and finally ships everything — which typically means
source files, test files, tsconfig, and build config end up in the published tarball.

## Verifying the tarball

Run from the repo root to see exactly what would be published:

```bash
pnpm --filter @stellarlens/sdk build
cd packages/sdk
npm pack --dry-run
```

The output lists every file that would be included. Expected entries are:

```
dist/index.js
dist/index.cjs
dist/index.d.ts
dist/index.d.cts
dist/webhooks.js
dist/webhooks.cjs
dist/webhooks.d.ts
dist/webhooks.d.cts
CHANGELOG.md
package.json
README.md   (if present — npm always includes it)
```

No `src/`, `tsup.config.*`, `tsconfig.*`, `vitest.config.*`, or `*.test.*` files should appear.

## Acceptance criteria checklist

- [x] A `files` field exists in `packages/sdk/package.json` listing `dist` and `CHANGELOG.md`.
- [ ] `npm pack --dry-run` confirms the tarball contains only the expected files.
- [ ] The published package resolves imports correctly after the change (`import { ... } from '@stellarlens/sdk'` and `require('@stellarlens/sdk')`).
