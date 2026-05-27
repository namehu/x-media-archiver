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
```

The current milestone is read-only. Write actions such as verify, requeue, export, and archive runs are reserved for P2.3.
