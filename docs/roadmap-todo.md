# x-media-archiver Roadmap TODO

Last updated: 2026-05-26

Status legend:

```text
[x] done
[~] in progress
[ ] pending
```

## V0 - Local CLI Archive Loop

Goal: make plugin-exported tweet URLs reliably become local media files, verified database records, and CSV outputs.

### V0.0 Design And Storage

- [x] Final design document created and reviewed.
- [x] Development database uses Docker Postgres.
- [x] Production database target is Supabase Postgres.
- [x] Initial Postgres schema created for tweets, media assets, download jobs, and attempts.
- [x] Downloader output contract documented from real gallery-dl and yt-dlp validation.

### V0.1 CLI Core

- [x] Dockerized Python CLI.
- [x] Archive directory initialization.
- [x] Database migration command.
- [x] Import concrete tweet URLs from tweet_urls.txt.
- [x] Import richer tweets.jsonl records.
- [x] Status command.
- [x] gallery-dl download command.
- [x] yt-dlp retry command.
- [x] Media metadata backfill into media_assets.
- [x] yt-dlp file normalization from video id directories to tweet id directories.
- [x] Verify command for verified, missing, and corrupt states.
- [x] CSV export for verified or all media statuses.
- [x] Tweet text and published_at backfill from downloader metadata.
- [x] Core unit and integration tests.

### V0.2 Browser Collector

- [x] Browser extension V0 created.
- [x] WXT + React rewrite completed.
- [x] Native Chrome extension i18n added.
- [x] Scan visible tweets.
- [x] Auto-scroll scan.
- [x] Export tweet_urls.txt.
- [x] Export tweets.jsonl.
- [x] Extension output validated against the CLI import/download/verify/export path.

### V0.3 One-Command Workflow

- [~] Implement archive-urls command.
- [ ] Import URL file inside archive-urls.
- [ ] Run gallery-dl first pass inside archive-urls.
- [ ] Run yt-dlp fallback inside archive-urls.
- [ ] Run backfill-media inside archive-urls.
- [ ] Run verify inside archive-urls.
- [ ] Export media CSV inside archive-urls.
- [ ] Generate failures CSV inside archive-urls.
- [ ] Print a compact run summary.
- [ ] Add README usage for archive-urls.
- [ ] Add tests for workflow summary and failure export helpers.

### V0 Self-Check

- [x] Plugin-exported tweet_urls.txt imports successfully.
- [x] End-to-end sample reached verified 5 / media_assets 5.
- [x] CSV export includes tweet_text for downloaded metadata.
- [ ] One-command archive workflow validated on the current examples file.
- [ ] Failure report validated with an empty-success case and a synthetic failure case.

## V1 - Productized Archive Management

Goal: make the tool suitable for recurring large archive runs and long-term management.

### V1.0 Reliability And Recovery

- [ ] Resume interrupted archive runs.
- [ ] Separate permanent failures from retryable failures with stronger classification.
- [ ] Retry with configurable max attempts and backoff.
- [ ] Detect cookie/auth failures explicitly.
- [ ] Add command to requeue missing/corrupt assets.

### V1.1 Search And Review

- [ ] Local search by author, text, media type, and status.
- [ ] HTML gallery export for quick review.
- [ ] Open local media from CSV or generated index.
- [ ] Deduplicate identical files across tweets by sha256.

### V1.2 Extension Improvements

- [ ] Export scan_stats.json.
- [ ] Configurable auto-scroll limits in UI.
- [ ] Pause and resume long scans.
- [ ] Better scan quality for quoted tweets and replies.
- [ ] Optional direct handoff to local CLI or local service.

### V1.3 Production Database

- [ ] Supabase connection guide.
- [ ] Supabase migration validation.
- [ ] Backup and restore instructions.
- [ ] Optional read-only dashboard queries.

## Maintenance Rules

- Update this file whenever a roadmap item is completed or the plan changes.
- Keep completed items checked only after code, docs, and verification are done.
- Add new tasks under the smallest relevant phase instead of keeping them only in chat.
