# Screenshots for the README

Demo screenshots aren't captured yet — this is a checklist of what to grab and where they'll live once
the README gets a visuals section.

## Setup

- Seed a little real data first (a contract or two, a few indexed events/transfers, one api key) so the
  screenshots show the populated states, not just empty tables.
- Browser window at **1440×900**, light mode (the app doesn't have a dark theme).
- Save as PNG under `docs/screenshots/`, named per the list below.

## Shots to capture

| File | Page | State |
|---|---|---|
| `login.png` | `/login` | Signed out |
| `onboarding.png` | `/contracts` | Zero contracts registered (the onboarding screen) |
| `contracts-list.png` | `/contracts` | One or more contracts registered |
| `contract-detail.png` | `/contracts/:id` | Stats cards + live events table populated |
| `contract-transfers.png` | `/contracts/:id/transfers` | Volume chart + transfers table populated |
| `settings.png` | `/settings` | Api keys list, ideally right after generating one (showing the
  one-time reveal banner) |

## Before publishing

- Redact real contract addresses, tx hashes, and — critically — never let a raw api key be visible in a
  published screenshot. Generate a throwaway key for the `settings.png` shot and revoke it immediately
  after.
- Once captured, reference them from `README.md` (e.g. under a new "Screenshots" section) using relative
  paths like `docs/screenshots/contract-detail.png`.
