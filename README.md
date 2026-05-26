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
