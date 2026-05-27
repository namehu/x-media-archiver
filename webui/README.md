# x-media-archiver WebUI

Local read-only archive console for Phase 2.

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
```

Operations can trigger:

```text
verify
requeue
recover-interrupted
export
archive-urls
```

Write actions are serialized by the local API. The WebUI does not expose destructive file deletion.
