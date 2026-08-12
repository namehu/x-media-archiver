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
Feed
Library
Tweet detail
Failures
Duplicates
Operations
Archive Queue
Sources
```

Search is Tweet-first and uses the local PostgreSQL full-text and trigram indexes across Tweet text, authors, tags, collections, and private notes. Its keyword, filters, sort, and pagination state are URL-backed; the default status is verified content. The result list reuses the Feed post card and full-screen media preview.

Operations can trigger:

```text
requeue
recover-interrupted
export database snapshot
full backfill / full verify under Maintenance only
```

Maintenance writes are protected by the local API's locking rules. Feed, Library, and Duplicates expose explicit, audited media deletion by `media_assets.id`; each flow requires confirmation and preserves Tweet and task history.

The Archive Queue page submits pasted URLs or browser-parsed TXT/JSONL records to the database
queue, displays per-run task states, and creates auditable retry runs. The API process owns a
background worker that consumes queued tasks while it is running.

The Operations page separates full-disk maintenance from routine actions. Full media backfill and
full file verification require explicit confirmation because they scan the entire archive.

Sources supports resumable source scans, discovered-Tweet review, bulk update/download tasks, and named schedule policies. Runtime progress is projected through a read-only WebSocket channel with REST snapshot fallback.
