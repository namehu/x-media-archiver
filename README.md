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

For disposable local validation, reset the metadata database and re-apply all migrations with:

```bash
docker-compose run --rm xarchiver db reset --yes
```

This clears Postgres metadata only. It does not delete files under `archive/`.

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

Media files are stored under stable path segments:

```text
archive/media/<author_id>/<tweet_id>/<tweet_id>--p<media_index>.<ext>
```

Usernames are kept in Postgres metadata for search and display, but are not used as the primary
filesystem directory name.

Recommended one-command workflow after exporting URLs from the browser extension:

```bash
docker-compose run --rm xarchiver archive-urls /app/examples/tweet_urls.example.txt
```

This command parses the local file and submits a database-backed archive run. The API worker processes queued tweets while `xarchiver serve` is running, using scoped download, backfill, and verify operations. Run export commands separately when a database snapshot is needed.

Queue JSONL input through the same service:

```bash
docker-compose run --rm xarchiver archive-jsonl /app/examples/tweets.example.jsonl
```

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
QUEUE_BATCH_SIZE=20
DOWNLOADER_SLEEP_MIN_SECONDS=2
DOWNLOADER_SLEEP_MAX_SECONDS=6
SOURCE_SCAN_BATCH_SIZE=20
SOURCE_SCAN_SLEEP_MIN_SECONDS=20
SOURCE_SCAN_SLEEP_MAX_SECONDS=45
STUCK_TIMEOUT_MINUTES=120
API_HOST=0.0.0.0
API_PORT=8000
```

`QUEUE_BATCH_SIZE` limits how many queued tweets the API worker claims in one pass. The downloader
sleep settings are passed through to `gallery-dl` / `yt-dlp` so large batches do not hammer X/Twitter
with back-to-back requests. `SOURCE_SCAN_BATCH_SIZE` and `SOURCE_SCAN_SLEEP_*` control historical
source discovery separately from downloading.

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
GET /api/archive-runs
GET /api/archive-runs/{run_id}
```

Available write API endpoints are serialized by a process-local lock. If one write action is already
running, the API returns `409 write_action_in_progress`.

```text
POST /api/actions/verify
POST /api/actions/requeue
POST /api/actions/recover-interrupted
POST /api/actions/export
POST /api/archive-runs
POST /api/archive-runs/{run_id}/retry
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
Archive Queue
Sources
```

Archive Queue accepts pasted URLs or local TXT/JSONL files parsed in the browser and submits structured database tasks. Operations can trigger requeue, recover-interrupted, and database snapshot export. Full backfill and full verify are isolated under Maintenance and require explicit disk-scan confirmation. The WebUI does not expose destructive file deletion.

Sources records long-lived X/Twitter origins such as profile pages, media tabs, likes,
bookmarks, search pages, or manual collections. A source can submit discovered tweet URLs into the
same Archive Queue while preserving source-to-tweet traceability. The current implementation provides
the recoverable source model, manual discovered-URL submission, and small-batch `gallery-dl` scanning
for profile timelines and user media pages. Source scanning records discovered tweets only; it does
not automatically submit them to the download queue. Use the explicit submit action when you are ready
to download a controlled batch. Each controlled scan records its logical batch window,
duplicate/new counts, and cursor diagnostics in `archive_sources.cursor_state`.
Real validation on 2026-05-27 showed that numeric ranges are not an efficient continuation mechanism
for deep media history. The source collector now persists the Twitter extractor's native continuation
cursor and uses it for historical batches. Scanning records discoveries only and never submits downloads
automatically. Every attempted source scan, plus
each deferral caused by active downloads, is persisted in `source_scan_runs` with its range,
cursor snapshots, counts, outcome, and error summary. The Sources detail page exposes the latest
20 scan events and cumulative statistics so a stalled history scan can be diagnosed after restart
without relying on container logs.

See [`docs/source-scanning-workflow.md`](docs/source-scanning-workflow.md) for the button meanings and
workflow, and [`docs/source-scanning-acceptance.md`](docs/source-scanning-acceptance.md) for the
native-cursor blocker found during real source validation.

## Archive Queue

Archive submissions are stored as runs and per-tweet task items in Postgres:

```text
WebUI records / CLI file parser
  -> archive_runs + archive_run_items
  -> API background worker
  -> scoped download / backfill / verify
```

Run migrations before first use:

```bash
docker-compose run --rm xarchiver db migrate
```

Open the WebUI `Archive Queue` page to:

```text
1. Submit one or more tweet URLs.
2. Select a local TXT or JSONL export for browser-side parsing and submission.
3. Review runs and per-tweet task outcomes.
4. Retry failed items as a new auditable run.
```

Queue behavior:

```text
1. Each submission creates an archive run and de-duplicates repeated tweet IDs inside that run.
2. Already verified tweets are recorded as skipped_verified without disk I/O.
3. Tweets already pending in another run are recorded as linked_pending without duplicate download.
4. The API worker consumes pending/retryable task items only while the API service is running.
5. Runs verify only newly affected media and report full-library totals from Postgres.
6. CLI TXT/JSONL paths are input adapters only; no watched input directory is used.
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
docker-compose run --rm xarchiver db reset --yes
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

The GitHub Actions CI pipeline runs the same backend suite on a freshly reset test database, plus
`npm run check` in both `webui/` and `extension/`. See
[`docs/engineering-ci-and-test-isolation.md`](docs/engineering-ci-and-test-isolation.md) for the
test isolation contract.

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
