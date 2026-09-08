# x-media-archiver WebUI

Local-first archive console for x-media-archiver.

## Stack

```text
Vite
React
TanStack Query
React Router
Tailwind
local shadcn-style components
```

## Development

Start the API:

```bash
docker-compose run --rm --service-ports xarchiver serve
```

Start the WebUI:

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

The Vite dev server proxies `/api`, `/health`, and `/openapi.json` to `VITE_API_PROXY_TARGET`, defaulting to `http://127.0.0.1:18000`.

The VSCode F5 task starts the API on `http://127.0.0.1:18000` and sets `VITE_API_PROXY_TARGET` automatically for the WebUI task.

Generate OpenAPI schema and TypeScript types:

```bash
npm run generate:api-types
```

This uses the Docker backend environment and writes the ignored temporary file `.openapi.json` plus `src/api/generated.ts`. The handwritten API facade in
`src/lib/api.ts` remains the stable import path for pages, while shared request behavior lives in
`src/api/client.ts`.

## Scope

Current pages:

```text
Dashboard
Search
Insights
Feed
Library
Collections
Tweet detail
Failures
Duplicates
Operations
Archive Queue
Sources
```

Search is Tweet-first and uses the local PostgreSQL full-text and trigram indexes across Tweet text, authors, tags, collections, and private notes. Its keyword, filters, sort, and pagination state are URL-backed; the default status is verified content. The result list reuses the Feed post card and full-screen media preview.

Feed keeps its submitted filters and ordering in the URL. It supports the default newest-first order and a stable seeded random order that composes with All, Likes, source, author, text, and media-type filters. The full-screen preview moves vertically through Tweets in the active Feed order and horizontally through media within a Tweet, with touch, wheel/trackpad, keyboard, and visible-button alternatives while preserving video playback state and one-step Back/Escape dismissal.

Operations can trigger:

```text
requeue
recover-interrupted
export database snapshot
full backfill / full verify under Maintenance only
```

Maintenance writes are protected by the local API's locking rules. Feed, Library, and Duplicates expose explicit, audited media deletion by `media_assets.id` and preserve Tweet and task history. Library confirmation includes an unchecked “本次不再提示” option: checking it and confirming deletion skips subsequent Library single-item and batch confirmations for the current `sessionStorage` lifetime, including reloads and route changes. Cancelling does not save the option; storage failures keep confirmation enabled. Feed and Duplicates continue to confirm each deletion.

In Library, `Del` deletes the current preview item, or the checked media in deletion selection mode when no preview is open. It uses the same confirmation preference as the delete button. No target, organization selection mode, editable focus, covering dialogs/menus, modified keys and held-key repeats do not trigger deletion. Pending requests block repeated deletion. Preview deletion advances to the next item, falls back to the previous item, and closes the preview when none remain. Failed deletions keep the target and expose a retry using the original operation ID.

The Archive Queue page submits pasted URLs or browser-parsed TXT/JSONL records to the database
queue, displays per-run task states, and creates auditable retry runs. The API process owns a
background worker that consumes queued tasks while it is running.

The Operations page separates full-disk maintenance from routine actions. Full media backfill and
full file verification require explicit confirmation because they scan the entire archive.

Sources supports resumable source scans, discovered-Tweet review, bulk update/download tasks, and named schedule policies. Runtime progress is projected through a read-only WebSocket channel with REST snapshot fallback.
