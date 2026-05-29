# WebUI Style Guide

> Status: implemented  
> Scope: `webui/` visual language, design tokens, component usage, and page composition  
> Last updated: 2026-05-29

This document describes the current WebUI design system after the Phase 4 revamp. It replaces the milestone planning documents and should be treated as the source of truth for future UI work.

## Design Position

The WebUI is a local media archive console. It should feel quiet, fast, and content-first, with the archived media and operational state as the visual focus.

The visual direction is a white and blue, Pixiv-like control surface:

- White or near-black base surfaces, depending on theme.
- Pixiv blue as the single primary brand color.
- Light borders, restrained elevation, and high information density.
- Media thumbnails, status, and data tables carry the page hierarchy.
- No decorative gradients, color blobs, marketing hero sections, or oversized card layouts.

## Color Tokens

All color usage should go through CSS variables in `webui/src/styles.css` and Tailwind aliases in `webui/tailwind.config.js`.

Core tokens:

- Background: `bg-bg-base`, `bg-bg-surface`, `bg-bg-elevated`, `bg-bg-muted`
- Borders: `border-border-subtle`, `border-border-strong`
- Text: `text-fg-primary`, `text-fg-secondary`, `text-fg-tertiary`
- Brand: `text-brand`, `bg-brand`, `bg-brand-soft`, `hover:bg-brand-hover`
- Status: `success`, `warning`, `danger`, `info`
- Elevation: `shadow-1`, `shadow-2`, `shadow-3`

Do not introduce page-level hardcoded colors such as `#0096FA`, raw HSL values, or Tailwind palette colors when an existing token fits.

## Typography

The global font stack is:

```css
"Inter", "Noto Sans SC", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
```

Use the following hierarchy:

- `text-xs`: metadata, helper text, compact badges.
- `text-sm`: default UI text, table cells, labels.
- `text-base`: body emphasis when needed.
- `text-lg`: card titles.
- `text-xl` and `text-2xl`: page and section headings.
- `text-3xl`: stat values only.

Use `tabular-nums` for counters, queue counts, pool metrics, file sizes, and progress values.

## Layout

The app uses a persistent left sidebar and a compact top bar. Main pages should use dense but readable layouts:

- Page header: title, one-line description, and compact right-side status/action.
- Primary metrics: responsive StatCard grid.
- Main work area: tables, media grids, detail panels, or tabs.
- Avoid cards inside cards. Use cards for repeated items, data panels, modals, and tools only.
- Keep fixed-format controls stable with explicit dimensions or responsive grid tracks.

Spacing should stay on Tailwind steps `1`, `2`, `3`, `4`, `6`, `8`, and `12`.

## Components

Reusable UI components live in `webui/src/components/ui/`. File names are lowercase shadcn-style names.

Use these components for new UI:

- `button`, `input`, `select`, `checkbox`, `switch`
- `card`, `badge`, `tabs`, `table`, `data-table`
- `dialog`, `sheet`, `popover`, `dropdown-menu`, `tooltip`
- `skeleton`, `empty-state`, `error-state`, `toaster`
- `stat-card`, `sparkline`, `progress-ring`, `status-dot`, `live-indicator`
- `media-thumbnail`, `pagination`, `command`, `command-palette`

New pages should import from `components/ui/...`. Do not create a parallel component directory for one-off variants.

## Page Patterns

Dashboard:

- StatCards first.
- Charts and recent activity below.
- Live event state visible near the top.

Library:

- Sticky filters.
- Virtualized media grid.
- `MediaThumbnail` for all image/video previews.
- Stable aspect ratios to avoid layout shift.

Queue:

- Hero progress summary.
- Tabs for running/completed/failed/all.
- Detail panel keeps item attempts visible without full page navigation.

Sources:

- List/detail composition.
- Source details use tabs for overview, discovered tweets, scan history, and advanced actions.
- Source page container should remain small; hooks and panels own the workflow detail.

Operations:

- Three tabs: maintenance, system status, database tools.
- System status must show worker/write lock, queue backlog, source scans, recent errors.
- Database tools must show DB pool active, idle, and waiting metrics.

Failures and Duplicates:

- Start with aggregation cards.
- Preserve dense row scanning.
- Provide clear links back to Tweet details.

Tweet Detail:

- 60/40 content split on desktop.
- Media grid on the left, metadata and attempts timeline on the right.
- Dialog preview supports keyboard navigation when open.

## Interaction

All interactive elements must have visible focus state:

```tsx
focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50
```

Expected global interactions:

- `Cmd/Ctrl+K`: command palette.
- `/`: command palette when focus is not inside an editable field.
- `Esc`: close dialogs and popovers.
- `J/K`: media navigation inside Tweet detail preview.

Hover should be subtle: border strengthening, `shadow-2`, or token-based background changes. Avoid motion that changes layout.

## Accessibility

Minimum expectations:

- Interactive controls must be keyboard reachable.
- Dialogs and sheets should use Radix primitives.
- Images must include `alt`, even when decorative.
- Status-only color changes should be paired with text, `Badge`, or `StatusDot`.
- Avoid hiding important state in hover-only content.
- Respect reduced-motion via the global CSS rule in `styles.css`.

## Internationalization

New visible copy should be added to `webui/src/locales/zh.ts` and `webui/src/locales/en.ts`.

English may be concise, but keys must exist. Avoid relying on fallback keys for production UI.

## What Not To Reintroduce

- Legacy uppercase component files such as `Button.tsx`, `Card.tsx`, `Toast.tsx`.
- Parallel migration-only component directories or page-specific component libraries.
- One-off hardcoded brand colors.
- Marketing landing-page sections.
- UI cards nested inside other UI cards.
- Media deletion actions in WebUI.
- Implicit full archive scans without explicit confirmation.

## Verification Checklist

Before handing off future UI changes:

- `npm run typecheck`
- `npm run build`
- `git diff --check`
- No migration-only component path or symbol names remain in `webui/src`.
- The touched page renders in light and dark theme.
- Empty, loading, and error states are covered.
- Keyboard focus is visible for new controls.
