# Screenshots for the README

Checklist of what to grab for the README's visuals section, and where they live.

## Setup

- Seed a little real data first (a contract or two, a few indexed events/transfers, one api key) so the
  screenshots show the populated states, not just empty tables. `pnpm --filter @stellarlens/web seed-demo`
  does this for contracts/events/transfers.
- Browser window at **1440×900**, light mode (the app doesn't have a dark theme).
- Save as PNG under `docs/screenshots/`, named per the list below.

## Shots to capture

| File | Page | State | Status |
|---|---|---|---|
| `login.png` | `/login` | Signed out | not yet captured |
| `onboarding.png` | `/contracts` | Zero contracts registered (the onboarding screen) | not yet captured |
| `contracts-list.png` | `/contracts` | One or more contracts registered | captured, in README |
| `contract-detail.png` | `/contracts/:id` | Stats cards + live events table populated | captured, in README |
| `contract-transfers.png` | `/contracts/:id/transfers` | Volume chart + transfers table populated | captured, in README |
| `settings.png` | `/settings` | Api keys list, ideally right after generating one (showing the
  one-time reveal banner) | not yet captured |

## Before publishing

- Redact real contract addresses, tx hashes, and — critically — never let a raw api key be visible in a
  published screenshot. Generate a throwaway key for the `settings.png` shot and revoke it immediately
  after.
- Once captured, reference them from `README.md` (e.g. under a new "Screenshots" section) using relative
  paths like `docs/screenshots/contract-detail.png`.
