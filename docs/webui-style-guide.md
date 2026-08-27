# WebUI Style Guide

> Status: implemented  
> Scope: `webui/` visual language, design tokens, component usage, and page composition  
> Last updated: 2026-08-26

This document describes the current WebUI design system after the Phase 4 revamp. It replaces the milestone planning documents and should be treated as the source of truth for future UI work.

## Design Position

The WebUI is a local media archive browser with an integrated management workspace. It should feel quiet, fast, and content-first, with archived posts and media as the primary visual focus while operational pages remain efficient and consistent.

The visual direction takes its browsing rhythm from X/Twitter without copying its product identity:

- Light mode is the default. Browsing surfaces are white; management surfaces use a very light neutral background.
- Archive blue is the single primary brand color; semantic status colors are reserved for state.
- Light dividers, near-black primary text, restrained corner radii, and almost no persistent elevation.
- Media thumbnails, status, and data tables carry the page hierarchy.
- Navigation uses Lucide icons and visible text labels; the active state uses weight and a neutral pill, with blue reserved for selection indicators and primary actions.
- Authentication uses a solid navy context panel and the same tokens/components as the console.
- No decorative gradients, color blobs, marketing hero sections, or oversized card layouts.

The product has two workspace modes that share the same shell and component language:

- Browsing workspace: X-like timeline or media-grid composition, white canvas, continuous content separated by rules, and a contextual filter column on wide screens.
- Management workspace: responsive tables, cards, charts, forms, and task panels on the soft neutral canvas.
- Different page structures are intentional; typography, colors, borders, control heights, focus states, and navigation remain identical across both modes.

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

The app uses a desktop sidebar that expands to 248px and collapses to a 76px icon rail, plus a 56px compact top bar. The sidebar brand header is also 56px so its bottom divider aligns exactly with the top-bar divider. The user's desktop sidebar preference is persisted locally. The sidebar footer is reserved exclusively for the expand/collapse control; do not place static descriptions or status copy there. Expanded and collapsed navigation share the same vertical grid: 48px item rows, 4px item gaps, 24px group-header rows, and 8px group breaks. In collapsed mode, group labels become centered separators without changing their row height, so item positions remain stable while toggling. Collapsed controls align to one horizontal center axis with the brand mark and footer toggle. The active destination uses a neutral rounded surface and stronger label weight. The navigation rail scrolls independently when viewport height is limited. On narrow screens, navigation moves into a left sheet.

The route hierarchy is content-first:

- `/` redirects to `/feed`.
- Browsing destinations appear first: home feed, media, search, collections, custom tags, and insights.
- Management and maintenance destinations remain directly accessible in separate navigation groups.
- The feed uses a maximum 1120px workspace with a 680px content stream and a contextual right column.
- Management content remains centered at a maximum width of 1600px.

Main pages should use dense but readable layouts:

- Page header: title, one-line description, and compact right-side status/action; only one action should receive primary emphasis.
- Primary metrics: responsive StatCard grid on management pages only.
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

- Dashboard is a management destination, not the default product entry.
- StatCards first.
- Place status distribution and the current running summary in the main two-column work area.
- Render status distribution as directly labeled count-and-percentage bars rather than a decorative pie or donut.
- Keep recent exports and the local archive path below the operational summary.
- Only fact-backed charts and current-state summaries below; do not synthesize trends or recent activity from current totals.
- Live event state remains visible once in the global top bar; the dashboard does not duplicate it.

Library:

- Use the same immersive white browsing canvas as the feed, with a maximum workspace width of 1280px and subtle side dividers.
- Keep the title and result count in one compact sticky header. Media-wall/detail switching and density controls belong in the display-settings menu, not in a persistent tab row. Do not add a persistent active-filter row: show the active count inside the filter button and keep filter details and reset actions in the Sheet. Batch actions also belong in a secondary menu rather than a large persistent toolbar.
- Filters open in a right `Sheet` on every viewport so changing filter visibility never squeezes or shifts the media grid.
- The primary media view is a virtualized square grid with 4px gutters, cover-cropped thumbnails, and responsive density. Start with three columns on a standard phone; reveal author and dimension metadata on hover or keyboard focus without reserving a caption row for every item.
- The detail view uses flat, continuous media rows rather than repeated floating cards.
- Use `MediaThumbnail` for image/video previews and preserve stable aspect ratios, scroll position, grid state, selection state, and preview navigation.

Search:

- Use a centered 680px continuous browsing stream with the same white canvas, side dividers, post anatomy, and media behavior as the feed.
- The sticky header contains the primary keyword input, search action, and one filter trigger. Do not add a separate page hero, description block, persistent filter column, or outer result card.
- Put all structured refinements in a right `Sheet` at every viewport width. The primary keyword remains in the header and is not counted as an active refinement.
- Keep search-specific context compact: highlight matched text and expose relevant tags, collections, notes, and exceptional archive status, but do not show implementation-facing relevance scores or repeat the default verified state.

Collections:

- Use a centered, narrow browsing stream with a compact sticky header. The default view is the collection catalog; do not keep collection details permanently beside it.
- Open a collection as a URL-addressable detail state so refresh, back, and direct links remain predictable. Detail content uses flat Tweet rows separated by rules.
- Keep collection settings in a right Sheet. Editing uses the shared dialog and destructive deletion retains explicit confirmation copy.
- Collection covers may establish visual identity, but metadata and actions must remain readable when no cover exists.

Custom Tags:

- Custom tags are a top-level browsing and organization destination, separate from collections and platform Hashtags. Never hide the complete tag catalog inside a collection Sheet.
- Use a centered, narrow directory with persistent search, URL-backed sort state, exact usage counts, and virtualized rows so large tag catalogs remain responsive.
- Selecting a tag opens Search with its `tag_id` applied. Editing uses the shared dialog; deletion requires explicit confirmation and preserves Tweets, media, collections, tasks, and notes.
- Search, empty, loading, error, light, dark, and narrow-screen states must remain usable without horizontal scrolling.

Insights:

- Use an immersive white data canvas with continuous sections and subtle rules, not a wall of independent statistic and chart cards.
- Start with a compact factual overview, then show the two real time dimensions: content publication and local import. Do not infer trends that the API does not supply.
- Reserve charts for temporal change. Show categorical distributions as directly labeled horizontal rows and keep exact values visible in text or tables.
- Keep the page read-only. Loading, empty, and error states retain the same compact page header and canvas width.

Queue:

- Use a flat hero progress summary without gradients or decorative elevation.
- Tabs for running/completed/failed/all.
- Detail panel keeps item attempts visible without full page navigation.
- The global top bar owns runtime connection status; queue cards describe batch state and must not repeat the live-connection label.

Sources:

- List/detail composition.
- Source details use tabs for overview, discovered tweets, scan history, and advanced actions.
- Source page container should remain small; hooks and panels own the workflow detail.

Operations:

- Five tabs: maintenance, system status, logs, Cookies, database tools.
- Keep the five tabs in that order and allow the tab row to scroll on narrow screens instead of wrapping or compressing labels.
- System status must show worker/write lock, queue backlog, source scans, recent errors.
- Database tools must show DB pool active, idle, and waiting metrics.
- Runtime transport counters belong in one continuous diagnostic section rather than a second wall of StatCards.

Failures and Duplicates:

- Start with aggregation cards.
- Preserve dense row scanning.
- Provide clear links back to Tweet details.
- Failure filters remain visible because filtering is the primary management task; keep them in one compact toolbar rather than scattering controls across cards.
- Each duplicate hash group is one continuous section. Media items may have bounded tiles, but do not nest the whole group inside another stack of decorative cards.

Tweet Detail:

- Treat Tweet detail as an immersive browsing route with a centered content stream and a contextual management column.
- The stream header owns back navigation and archive status; author, text, hashtags, media, and post metadata form one continuous article.
- Use an approximately 65/35 content split on desktop; stack the management column below the article on narrow screens.
- Media stays in the article stream, while organization, metadata, and attempts remain in the contextual column.
- Dialog preview supports keyboard navigation when open.

Feed:

- Use a continuous white timeline with horizontal dividers; do not wrap the full feed in a floating card.
- Post anatomy follows avatar rail, single-line author metadata, body text, organization context, then dominant media.
- Media uses stable aspect ratios and X-like one/two/four-item compositions with large rounded media corners.
- On wide screens, filters live in the right contextual column; on narrow screens, filters move into a Sheet.
- Preserve scroll, video playback, and preview state when navigating back.

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

Persistent cards should not use decorative shadows. Reserve elevation for menus, dialogs, sheets, and transient overlays.

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
