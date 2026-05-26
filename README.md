# x-media-archiver

Local-first X/Twitter media archiver. V0 focuses on a Dockerized CLI pipeline:

```text
tweet URLs -> download -> media_assets backfill -> verify -> CSV export
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
docker-compose run --rm xarchiver verify
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

This command imports the URL file, runs gallery-dl, runs yt-dlp fallback, rebuilds media metadata, verifies files, exports media CSV, and exports failures CSV.

## Commands

Dry-run a download job without calling the downloader:

```bash
docker-compose run --rm xarchiver download --engine gallery-dl --dry-run
```

Rebuild `media_assets` from existing files under `archive/media`:

```bash
docker-compose run --rm xarchiver backfill-media
```

Verify file existence and hashes:

```bash
docker-compose run --rm xarchiver verify
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

Export a static HTML gallery for verified media:

```bash
docker-compose run --rm xarchiver export-gallery
docker-compose run --rm xarchiver export-gallery --status all
```

Production metadata storage in Supabase, including connection selection and migration checks, is
documented in [`docs/supabase-deployment.md`](docs/supabase-deployment.md). Backup and restore
procedures are documented in [`docs/backup-restore.md`](docs/backup-restore.md).

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
