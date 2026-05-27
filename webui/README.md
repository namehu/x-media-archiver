# x-media-archiver WebUI

Local archive console for Phase 2.

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

The Vite dev server proxies `/api` and `/health` to `http://127.0.0.1:8000`.

## Scope

Current pages:

```text
Dashboard
Library
Tweet detail
Failures
Duplicates
Operations
Archive Queue
```

Operations can trigger:

```text
requeue
recover-interrupted
export database snapshot
full backfill / full verify under Maintenance only
```

Write actions are serialized by the local API. The WebUI does not expose destructive file deletion.

The Archive Queue page submits pasted URLs or browser-parsed TXT/JSONL records to the database
queue, displays per-run task states, and creates auditable retry runs. The API process owns a
background worker that consumes queued tasks while it is running.

The Operations page separates full-disk maintenance from routine actions. Full media backfill and
full file verification require explicit confirmation because they scan the entire archive.
