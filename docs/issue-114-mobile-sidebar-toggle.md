# Issue #114 — Mobile menu toggle for the dashboard sidebar

**Complexity:** medium  
**Files:** `apps/web/components/Sidebar.tsx`, `apps/web/app/(dashboard)/layout.tsx`

## Status

Already resolved. `Sidebar.tsx` implements a full off-canvas drawer with a hamburger toggle for
small screens, and the desktop layout is unaffected.

## How it works

### Layout split

`apps/web/app/(dashboard)/layout.tsx` renders the outer shell:

```tsx
<div className="flex min-h-screen w-full flex-col md:flex-row">
  <Sidebar authenticated={Boolean(session)} />
  <main className="flex-1 p-4 md:p-8">…</main>
</div>
```

Below `md` the flex direction is `flex-col`, so the sidebar and main content stack vertically.
At `md` and above it switches to `flex-row`. `Sidebar` takes care of its own visibility at each
breakpoint.

### Mobile top bar

A `<header>` is rendered only below `md` (`md:hidden`). It shows the app name and a hamburger
button that sets `open = true`:

```tsx
<header className="… md:hidden">
  <span>stellarlens</span>
  <button onClick={() => setOpen(true)} aria-label="Open menu">
    {/* hamburger SVG */}
  </button>
</header>
```

### Off-canvas drawer

The `<nav>` element is `fixed` on mobile and translates off-screen when `open` is `false`:

```
open=false  →  -translate-x-full   (hidden off left edge)
open=true   →   translate-x-0      (slid in)
```

At `md` and above, `md:static md:translate-x-0 md:transition-none` force the nav back into normal
flow and permanently visible, completely independent of the `open` state.

A close button inside the drawer (`md:hidden`) sets `open = false`. Every `<Link>` also calls
`setOpen(false)` via `onClick` so the drawer closes on navigation.

### Backdrop

A fixed full-screen overlay (`bg-black/50`) is rendered behind the drawer while `open` is `true`.
Clicking it closes the drawer. It is `md:hidden` and only mounted while open (no layout cost when
closed):

```tsx
{open && (
  <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setOpen(false)} />
)}
```

### z-index layering

| Element | z-index |
|---|---|
| Backdrop | `z-30` |
| Drawer `<nav>` | `z-40` |

The drawer sits above the backdrop, so clicks on the nav content do not fall through to the close handler.

### Keyboard / focus

- The open button has `aria-label="Open menu"`.
- The close button inside the drawer has `aria-label="Close menu"`.
- Both SVG icons carry `aria-hidden="true" focusable="false"` so screen readers skip the decorative graphic.
- Focus is not explicitly trapped inside the drawer. If full focus trapping is needed later, a
  `focus-trap` utility or the native `<dialog>` element would be the right addition.

## Acceptance criteria checklist

- [x] On small screens the sidebar is collapsed behind a toggle instead of always rendered inline.
- [x] Opening the menu does not break keyboard navigation (labelled buttons, non-focusable SVGs).
- [x] Desktop/`md:` layout is unaffected (`md:static md:translate-x-0`).
- [ ] Focus is trapped inside the open drawer (not currently implemented — optional follow-up).
