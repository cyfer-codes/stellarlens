# Issue #117 — Add `repository`, `bugs`, and `homepage` fields to `package.json`

**Complexity:** trivial  
**File:** `packages/sdk/package.json`

## Background

The `@stellarlens/sdk` package is published to npm but its `package.json` does not declare
`repository`, `bugs`, or `homepage`. Without them, npm cannot link to the source repo or issue
tracker on the package's npm page, and tools like Renovate or Dependabot cannot resolve the
repository to surface changelogs.

## What to add

Open `packages/sdk/package.json` and add three fields at the top level, alongside `name` and
`version`:

```json
{
  "name": "@stellarlens/sdk",
  "version": "0.1.0",
  "description": "Typed TypeScript client for the stellarlens API",
  "repository": {
    "type": "git",
    "url": "https://github.com/cyfer-codes/stellarlens.git",
    "directory": "packages/sdk"
  },
  "bugs": {
    "url": "https://github.com/cyfer-codes/stellarlens/issues"
  },
  "homepage": "https://github.com/cyfer-codes/stellarlens#readme"
}
```

### Field notes

- **`repository.directory`** — required for monorepo packages so that tools know the package lives
  under `packages/sdk/`, not the repo root.
- **`bugs.url`** — the GitHub issues page. If there is a dedicated support address, it can also
  carry an `email` key, but the URL alone satisfies the npm convention.
- **`homepage`** — points to the root `README.md` via the `#readme` anchor, which npm uses as the
  "homepage" link on the package page. Update this once dedicated SDK documentation exists.

## Verifying the change

Run `npm pack --dry-run` from `packages/sdk/` after building to confirm the new fields are present
in the tarball's `package.json`:

```bash
pnpm --filter @stellarlens/sdk build
cd packages/sdk
npm pack --dry-run
```

Also check that `npm info @stellarlens/sdk` (after publishing) returns the correct repository and
bugs URLs.

## Acceptance criteria checklist

- [ ] `packages/sdk/package.json` contains a `repository` object with `type`, `url`, and `directory`.
- [ ] `packages/sdk/package.json` contains a `bugs` object with a `url` pointing to the GitHub issues page.
- [ ] `packages/sdk/package.json` contains a `homepage` string.
- [ ] No other fields in `package.json` are changed.
