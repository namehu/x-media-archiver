# x-media-archiver

Local-first X/Twitter media archiver.

## V0 Development

Start with the CLI and Docker Postgres core before building the browser extension.

```bash
docker compose build xarchiver
docker compose run --rm xarchiver init /app/archive
docker compose run --rm xarchiver db migrate
docker compose run --rm xarchiver import-urls /app/examples/tweet_urls.example.txt
docker compose run --rm xarchiver status
docker compose run --rm xarchiver download --engine gallery-dl --dry-run
```

For real downloads, place an exported X/Twitter cookies file at:

```text
secrets/cookies.txt
```

Then replace `examples/tweet_urls.example.txt` with real tweet URLs and run:

```bash
docker compose run --rm xarchiver download --engine gallery-dl
docker compose run --rm xarchiver retry --engine yt-dlp
```

If media files already exist under `archive/media`, rebuild `media_assets` from downloader metadata with:

```bash
docker compose run --rm xarchiver backfill-media
```
