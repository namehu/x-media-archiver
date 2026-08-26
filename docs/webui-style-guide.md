# WebUI Style Guide

> Status: implemented  
> Scope: `webui/` visual language, design tokens, component usage, and page composition  
> Last updated: 2026-08-26

This document describes the current WebUI design system after the Phase 4 revamp. It replaces the milestone planning documents and should be treated as the source of truth for future UI work.

## Design Position

The WebUI is a local media archive console. It should feel quiet, fast, and content-first, with the archived media and operational state as the visual focus.

The visual direction is a quiet blue-and-neutral operations workspace:

- White or deep blue-black base surfaces, depending on theme.
- Archive blue is the single primary brand color; semantic status colors are reserved for state.
- Soft neutral page surfaces, light borders, modest corner radii, and restrained elevation.
- Media thumbnails, status, and data tables carry the page hierarchy.
- Navigation uses Lucide icons and visible text labels; active state uses a blue soft surface.
- Authentication uses a solid navy context panel and the same tokens/components as the console.
- No decorative gradients, color blobs, marketing hero sections, or oversized card layouts.

## Color Tokens

All color usage should go through CSS variables in `webui/src/styles.css` and Tailwind aliases in `webui/tailwind.config.js`.

Core tokens:

- Background: `bg-bg-base`, `bg-bg-surface`, `bg-bg-elevated`, `bg-bg-muted`
- Borders: `border-border-subtle`, `border-border-strong`
- Text: `text-fg-primary`, `text-fg-secondary`, `text-fg-tertiary`
- Brand: `text-brand`, `bg-brand`, `bg-brand-soft`, `hover:bg-brand-hover`
- Status: `success`, `warning`, `danger`, `info`
- Authentication: `auth-panel`, `auth-panel-fg`
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

The app uses a desktop sidebar that expands to 256px and collapses to a 72px icon rail, plus a 56px compact top bar. The sidebar brand header is also 56px so its bottom divider aligns exactly with the top-bar divider. The user's desktop sidebar preference is persisted locally. The sidebar footer is reserved exclusively for the expand/collapse control; do not place static descriptions or status copy there. Expanded and collapsed navigation share the same vertical grid: 40px item rows, 8px item gaps, 20px group-header rows, and 24px group breaks. In collapsed mode, group labels become centered separators without changing their row height, so item positions remain stable while toggling. Collapsed controls align to one horizontal center axis with the brand mark and footer toggle, and only the current page receives the brand-soft active surface. The navigation rail scrolls independently when viewport height is limited. Main content is centered at a maximum width of 1600px. On narrow screens, navigation moves into a left sheet. Main pages should use dense but readable layouts:

- Page header: title, one-line description, and compact right-side status/action; only one action should receive primary emphasis.
- Primary metrics: responsive StatCard grid.
- Main work area: tables, media grids, detail panels, or tabs.
- Avoid cards inside cards. Use cards for repeated items, data panels, modals, and tools only.
- Keep fixed-format controls stable with explicit dimensions or responsive grid tracks.
- Prefer `flex flex-col gap-*` over `space-y-*`; use the repository spacing steps only.

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
- Place status distribution and the current running summary in the main two-column work area.
- Keep recent exports and the local archive path below the operational summary.
- Only fact-backed charts and current-state summaries below; do not synthesize trends or recent activity from current totals.
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

- Five tabs: maintenance, system status, logs, Cookies, database tools.
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

Buttons, inputs, and icon controls should provide at least a 40px default control box. Mobile text inputs use a 16px font size to prevent unintended browser zoom.

## Accessibility

Minimum expectations:

- Interactive controls must be keyboard reachable.
- Dialogs and sheets should use Radix primitives.
- Images must include `alt`, even when decorative.
- Status-only color changes should be paired with text, `Badge`, or `StatusDot`.
- Avoid hiding important state in hover-only content.
- Collapsed navigation icons must retain accessible names and show text labels in keyboard-accessible tooltips.
- Global live connection status appears once in the top bar; do not duplicate it in the sidebar.
- Respect reduced-motion via the global CSS rule in `styles.css`.

## Visible Copy

WebUI 当前只维护中文文案。用户可见文本直接写在对应页面或组件中，不新增 `locales`、翻译 key、`I18nProvider` 或 `useI18n`。浏览器扩展仍继续使用 Chrome 原生 i18n，两者边界不要混淆。

## What Not To Reintroduce

- Legacy uppercase component files such as `Button.tsx`, `Card.tsx`, `Toast.tsx`.
- Parallel migration-only component directories or page-specific component libraries.
- One-off hardcoded brand colors.
- Decorative gradients or blurred color blobs on authentication screens.
- Marketing landing-page sections.
- UI cards nested inside other UI cards.
- Media deletion outside the Library/Feed/Duplicates explicit, audited confirmation flow.
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
