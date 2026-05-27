# x-media-archiver

Local-first X/Twitter media archiver. V0 focuses on a Dockerized CLI pipeline:

```text
tweet URLs -> scoped download -> scoped media_assets backfill -> scoped verify
```

## V0 Quick Start

Build the CLI image and initialize the local archive directories:

```bash
docker-compose build xarchiver
docker-compose run --rm xarchiver init /app/archive
docker-compose run --rm xarchiver db migrate
```

Put exported X/Twitter cookies at:

```text
secrets/cookies.txt
```

The cookie file must use Netscape cookie format. Keep it local; it is ignored by git.

Replace `examples/tweet_urls.example.txt` with one tweet URL per line:

```text
https://x.com/PhysInHistory/status/2058554692586885322
https://x.com/dpoddolphinpro/status/2059072547585433944
```

Profile URLs such as `https://x.com/XiangHupt/likes` are not valid V0 inputs. V0 expects concrete `/status/<tweet_id>` URLs.

Import and inspect the queue:

```bash
docker-compose run --rm xarchiver import-urls /app/examples/tweet_urls.example.txt
docker-compose run --rm xarchiver status
```

Run the real download flow:

```bash
docker-compose run --rm xarchiver download --engine gallery-dl
docker-compose run --rm xarchiver retry --engine yt-dlp
docker-compose run --rm xarchiver verify --full
docker-compose run --rm xarchiver export --format csv
```

Output locations:

```text
archive/media/       downloaded media and metadata
archive/exports/     CSV exports
archive/state/       downloader state and runtime cookie copy
```

Recommended one-command workflow after exporting URLs from the browser extension:

```bash
docker-compose run --rm xarchiver archive-urls /app/examples/tweet_urls.example.txt
```

This command imports the URL file, runs gallery-dl and yt-dlp fallback only for input-scoped candidates, then backfills and verifies only media affected by that run. It reports current library totals from Postgres. Run export commands separately when a database snapshot is needed.

## Commands

Dry-run a download job without calling the downloader:

```bash
docker-compose run --rm xarchiver download --engine gallery-dl --dry-run
```

Rebuild `media_assets` from all existing files under `archive/media` (explicit full-disk maintenance):

```bash
docker-compose run --rm xarchiver backfill-media --full
```

Verify file existence and hashes for the entire media library (explicit full-disk maintenance):

```bash
docker-compose run --rm xarchiver verify --full
```

Export verified media:

```bash
docker-compose run --rm xarchiver export --format csv
```

Export every media status:

```bash
docker-compose run --rm xarchiver export --format csv --status all
```

Export failures:

```bash
docker-compose run --rm xarchiver export-failures
```

Requeue retryable, missing, or corrupt tweets:

```bash
docker-compose run --rm xarchiver requeue
docker-compose run --rm xarchiver requeue --status failed_retryable --status missing
```

Recover interrupted runs that left jobs or tweets in running/downloading states:

```bash
docker-compose run --rm xarchiver recover-interrupted
docker-compose run --rm xarchiver recover-interrupted --timeout-minutes 30
```

Export a static HTML gallery for verified media:

```bash
docker-compose run --rm xarchiver export-gallery
docker-compose run --rm xarchiver export-gallery --status all
```

Search archived media:

```bash
docker-compose run --rm xarchiver search --author veritasium
docker-compose run --rm xarchiver search --text chaos --media-type video
docker-compose run --rm xarchiver search --media-status all --limit 50
```

Find duplicate media by sha256:

```bash
docker-compose run --rm xarchiver duplicates
docker-compose run --rm xarchiver export-duplicates
```

Production metadata storage in Supabase, including connection selection and migration checks, is
documented in [`docs/supabase-deployment.md`](docs/supabase-deployment.md). Backup and restore
procedures are documented in [`docs/backup-restore.md`](docs/backup-restore.md).

If local port 5432 is already in use, override the development Postgres host port:

```bash
POSTGRES_PORT=5434 docker-compose up -d postgres
```

Retry behavior is controlled by environment variables:

```text
RETRY_LIMIT=3
RETRY_BACKOFF_MINUTES=15
STUCK_TIMEOUT_MINUTES=120
API_HOST=0.0.0.0
API_PORT=8000
```

## Local API and WebUI

Phase 2 adds a local FastAPI service and a React WebUI on top of the same Python archive core used by the CLI.

Start the API in Docker:

```bash
docker-compose run --rm --service-ports xarchiver serve
```

The compose file maps the API to the host loopback address:

```text
http://127.0.0.1:8000
```

Available read-only API endpoints:

```text
GET /health
GET /api/summary
GET /api/media
GET /api/tweets/{tweet_id}
GET /api/failures
GET /api/duplicates
GET /api/media-file/{relative_path}
GET /api/inbox
GET /api/inbox/settings
```

Available write API endpoints are serialized by a process-local lock. If one write action is already
running, the API returns `409 write_action_in_progress`.

```text
POST /api/actions/verify
POST /api/actions/requeue
POST /api/actions/recover-interrupted
POST /api/actions/export
POST /api/runs/archive-urls
POST /api/inbox/scan
POST /api/inbox/process-pending
POST /api/inbox/{id}/process
POST /api/inbox/settings
POST /api/maintenance/backfill
POST /api/maintenance/verify
```

Run the WebUI:

```bash
cd webui
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

The WebUI uses React, TanStack Query, React Router, Tailwind, and local shadcn-style UI components under `webui/src/components/ui`.

Current pages:

```text
Dashboard
Library
Tweet detail
Failures
Duplicates
Operations
```

Operations can trigger requeue, recover-interrupted, database snapshot export, and incremental archive-urls. Full backfill and full verify are isolated under Maintenance and require explicit disk-scan confirmation. The WebUI still does not expose destructive file deletion.

## Inbox Automation

The browser extension export can be handled from a watched local inbox:

```text
archive/inbox/
  tweet_urls_*.txt
  tweets_*.jsonl
  registered/YYYY-MM/   registered source files
  duplicates/YYYY-MM/   duplicate-content source files
```

Run migrations before first use:

```bash
docker-compose run --rm xarchiver db migrate
```

Open the WebUI `Inbox` page to:

```text
1. Scan files without processing them.
2. Process pending files manually.
3. Retry a failed file.
4. Enable or disable timed automatic processing.
5. Configure the automatic scan interval in minutes.
```

Inbox behavior:

```text
1. File content is identified by SHA-256; identical content is only registered once.
2. New files are moved out of the inbox root after registration; duplicate-content files are retained under `duplicates/`.
3. TXT input performs an input-scoped URL archive workflow.
4. JSONL input preserves richer tweet metadata, then performs the same input-scoped download and verification workflow.
5. Each processed file is linked to an archive_runs record.
6. Incremental runs verify only newly affected media and report full-library totals from Postgres.
7. Automatic processing is disabled by default and only runs while the local API service is running.
8. Automatic and manual writes share the P2.3 single-operation lock.
```

Full-disk maintenance is explicit:

```bash
docker-compose run --rm xarchiver backfill-media --full
docker-compose run --rm xarchiver verify --full
```

These maintenance commands traverse archived files and can generate significant disk I/O on large libraries. CSV export reads the database snapshot and does not perform a media-file hash scan.

## State Rules

`verify` checks each `media_assets.local_path`:

```text
file exists and sha256 matches     -> verified
file missing                       -> missing
file exists but sha256 mismatches  -> corrupt
```

Tweet status is aggregated from child media assets:

```text
all verified        -> verified
any corrupt         -> corrupt
any missing         -> missing
otherwise mixed     -> partial
```

## Tests

Run the V0 test suite inside Docker:

```bash
docker-compose run --rm --entrypoint python xarchiver -m unittest discover -s /app/tests
```

The suite covers:

```text
tweet URL parsing
gallery-dl metadata parsing
yt-dlp metadata parsing and normalization
verify aggregation rules
missing/corrupt/recovery integration flow
```

## Browser Extension V0

The extension is a WXT + React project with TypeScript and native Chrome extension i18n.

Install dependencies:

```bash
cd extension
npm install
```

Run the extension in WXT development mode:

```bash
npm run dev
```

Build a Chrome/Edge production bundle:

```bash
npm run build
npm run zip
```

Load the production build in Chrome or Edge:

```text
1. Open chrome://extensions
2. Enable Developer mode
3. Click Load unpacked
4. Select extension/.output/chrome-mv3/
```

Use it on an X/Twitter page such as likes, bookmarks, profile, search, or home:

```text
1. Open the target page on x.com or twitter.com
2. Click the X Media Archiver extension icon
3. Click Scan visible to collect currently mounted tweets
4. Click Auto scroll to keep scrolling and scanning
5. Click Stop when enough tweets are collected
6. Export URLs or JSONL
```

Exports:

```text
tweet_urls_<timestamp>.txt    one concrete /status/<tweet_id> URL per line
tweets_<timestamp>.jsonl      richer records for xarchiver import
scan_stats_<timestamp>.json   scan source, timing, counts, and auto-scroll outcome
```

The popup also lets you set the maximum scroll rounds, consecutive empty rounds, and scan
interval before starting a long auto-scroll scan.

Popup UI strings live in:

```text
extension/public/_locales/en/messages.json
extension/public/_locales/zh_CN/messages.json
```

Import extension output into the CLI:

```bash
docker-compose run --rm xarchiver import-urls /app/examples/tweet_urls.example.txt
docker-compose run --rm xarchiver import /app/examples/tweets.example.jsonl
```

After exporting from the browser, place the downloaded file under `examples/` or another mounted directory before importing it in Docker.
