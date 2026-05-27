from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from xarchiver.archive import ensure_archive_dirs
from xarchiver.config import get_settings
from xarchiver.exporter import export_media_gallery
from xarchiver.importer import import_jsonl, import_urls
from xarchiver.migrations import migrate
from xarchiver.search import compact_text, search_media
from xarchiver.services.library import list_duplicates
from xarchiver.services.queue import submit_jsonl_file, submit_urls_file
from xarchiver.services.runs import (
    run_backfill,
    run_download,
    run_export_duplicates,
    run_export_failures,
    run_export_media,
    run_recover_interrupted,
    run_requeue,
    run_verify,
)
from xarchiver.services.sources import (
    create_source,
    list_sources,
    scan_source,
    start_source_history_scan,
    stop_source_history_scan,
    submit_discovered_tweets,
    submit_source_records,
    update_source_status,
)
from xarchiver.status import get_media_count, get_status_counts

app = typer.Typer(help="Local-first X/Twitter media archiver.")
db_app = typer.Typer(help="Database commands.")
sources_app = typer.Typer(help="Source collector commands.")
app.add_typer(db_app, name="db")
app.add_typer(sources_app, name="sources")

console = Console()


@app.command()
def init(archive_dir: Path | None = typer.Argument(None, help="Archive directory to initialize.")) -> None:
    settings = get_settings()
    target = archive_dir or settings.archive_dir
    ensure_archive_dirs(target)
    console.print(f"Initialized archive directory: {target}")


@db_app.command("migrate")
def db_migrate() -> None:
    settings = get_settings()
    files = migrate(settings.sql_dir)
    if not files:
        console.print(f"No pending migrations in {settings.sql_dir}")
        return
    for file in files:
        console.print(f"Applied migration: {file}")


@app.command("import")
def import_command(path: Path = typer.Argument(..., help="Path to tweets JSONL.")) -> None:
    count = import_jsonl(path)
    console.print(f"Imported {count} tweets from {path}")


@app.command("import-urls")
def import_urls_command(path: Path = typer.Argument(..., help="Path to tweet_urls.txt.")) -> None:
    count = import_urls(path)
    console.print(f"Imported {count} tweet URLs from {path}")


@app.command("archive-urls")
def archive_urls_command(
    path: Path = typer.Argument(..., help="Path to tweet_urls.txt."),
) -> None:
    result = submit_urls_file(path)
    console.print(result)
    console.print("Queued for processing while `xarchiver serve` is running.")


@app.command("archive-jsonl")
def archive_jsonl_command(
    path: Path = typer.Argument(..., help="Path to tweets JSONL."),
) -> None:
    result = submit_jsonl_file(path)
    console.print(result)
    console.print("Queued for processing while `xarchiver serve` is running.")


@sources_app.command("create")
def source_create_command(
    source_url: str = typer.Argument(..., help="X/Twitter source URL."),
    source_type: str = typer.Option("profile", help="profile, user_media, likes, bookmarks, search, or manual."),
    label: str | None = typer.Option(None, help="Human-readable label."),
    author_username: str | None = typer.Option(None, help="Override inferred author username."),
) -> None:
    result = create_source(source_type, source_url, label=label, author_username=author_username)
    console.print(result)


@sources_app.command("list")
def source_list_command(
    status: str | None = typer.Option(None, help="Filter by source status."),
    source_type: str | None = typer.Option(None, help="Filter by source type."),
    limit: int = typer.Option(50, help="Maximum sources."),
) -> None:
    rows = list_sources(status=status, source_type=source_type, limit=limit)
    table = Table(title=f"x-media-archiver sources ({len(rows)} result(s))")
    table.add_column("ID", justify="right")
    table.add_column("Type")
    table.add_column("Status")
    table.add_column("Author")
    table.add_column("Discovered", justify="right")
    table.add_column("URL")
    for row in rows:
        table.add_row(
            str(row.get("id")),
            str(row.get("source_type") or ""),
            str(row.get("status") or ""),
            str(row.get("author_username") or ""),
            str(row.get("discovered_tweet_count") or row.get("discovered_count") or 0),
            str(row.get("source_url") or ""),
        )
    console.print(table)


@sources_app.command("submit-urls")
def source_submit_urls_command(
    source_id: int = typer.Argument(..., help="Archive source id."),
    path: Path = typer.Argument(..., help="Path to tweet_urls.txt discovered for this source."),
) -> None:
    records = [{"url": line.strip()} for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    result = submit_source_records(source_id, records)
    console.print(result)
    console.print("Queued for processing while `xarchiver serve` is running.")


@sources_app.command("pause")
def source_pause_command(source_id: int = typer.Argument(..., help="Archive source id.")) -> None:
    console.print(update_source_status(source_id, "paused"))


@sources_app.command("resume")
def source_resume_command(source_id: int = typer.Argument(..., help="Archive source id.")) -> None:
    console.print(update_source_status(source_id, "active"))


@sources_app.command("scan")
def source_scan_command(
    source_id: int = typer.Argument(..., help="Archive source id."),
    limit: int = typer.Option(20, help="Maximum posts to discover in this scan."),
    restart: bool = typer.Option(False, help="Start again from the latest posts instead of the saved cursor."),
) -> None:
    result = scan_source(source_id, limit, restart=restart)
    console.print(result)
    console.print("Discovered tweets were recorded. Submit them explicitly when you are ready to download.")


@sources_app.command("submit-discovered")
def source_submit_discovered_command(
    source_id: int = typer.Argument(..., help="Archive source id."),
    limit: int | None = typer.Option(None, help="Maximum unsubmitted discovered tweets to queue."),
) -> None:
    result = submit_discovered_tweets(source_id, limit=limit)
    console.print(result)
    console.print("Queued for processing while `xarchiver serve` is running.")


@sources_app.command("history-start")
def source_history_start_command(
    source_id: int = typer.Argument(..., help="Archive source id."),
    limit: int = typer.Option(20, help="Media range size to scan per batch."),
    restart: bool = typer.Option(False, help="Restart enumeration from the newest range."),
) -> None:
    console.print(start_source_history_scan(source_id, limit, restart=restart))
    console.print("Background discovery started. It records discoveries only and never queues downloads.")


@sources_app.command("history-stop")
def source_history_stop_command(source_id: int = typer.Argument(..., help="Archive source id.")) -> None:
    console.print(stop_source_history_scan(source_id))


@app.command("status")
def status_command() -> None:
    counts = get_status_counts()
    media_count = get_media_count()

    table = Table(title="x-media-archiver status")
    table.add_column("Status")
    table.add_column("Tweets", justify="right")
    for status, count in sorted(counts.items()):
        table.add_row(status, str(count))
    table.add_row("media_assets", str(media_count))
    console.print(table)


@app.command("search")
def search_command(
    author: str | None = typer.Option(None, help="Filter by author username or display name."),
    text: str | None = typer.Option(None, help="Filter by tweet text."),
    tweet_status: str | None = typer.Option(None, help="Filter by tweet status."),
    media_status: str | None = typer.Option("verified", help="Filter by media status. Use 'all' for every status."),
    media_type: str | None = typer.Option(None, help="Filter by media type, such as photo or video."),
    limit: int = typer.Option(20, help="Maximum results."),
) -> None:
    rows = search_media(
        author=author,
        text=text,
        tweet_status=tweet_status,
        media_status=None if media_status == "all" else media_status,
        media_type=media_type,
        limit=limit,
    )
    table = Table(title=f"x-media-archiver search ({len(rows)} result(s))")
    table.add_column("Author")
    table.add_column("Type")
    table.add_column("Status")
    table.add_column("Tweet Text")
    table.add_column("Local Path")
    for row in rows:
        author_label = row.get("author_username") or row.get("author_display_name") or ""
        table.add_row(
            str(author_label),
            str(row.get("media_type") or ""),
            str(row.get("media_status") or ""),
            compact_text(row.get("tweet_text")),
            str(row.get("local_path") or ""),
        )
    console.print(table)


@app.command("duplicates")
def duplicates_command() -> None:
    result = list_duplicates(get_settings())
    rows = result["rows"]
    groups = {row.get("sha256") for row in rows if row.get("sha256")}
    table = Table(title=f"x-media-archiver duplicates ({len(groups)} group(s), {len(rows)} file(s))")
    table.add_column("SHA256")
    table.add_column("Count", justify="right")
    table.add_column("Author")
    table.add_column("Type")
    table.add_column("Local Path")
    for row in rows:
        sha256 = str(row.get("sha256") or "")
        table.add_row(
            sha256[:12],
            str(row.get("duplicate_count") or ""),
            str(row.get("author_username") or ""),
            str(row.get("media_type") or ""),
            str(row.get("local_path") or ""),
        )
    console.print(table)


@app.command("download")
def download_command(
    engine: str | None = typer.Option(None, help="gallery-dl or yt-dlp."),
    limit: int | None = typer.Option(None, help="Maximum tweets to process."),
    dry_run: bool = typer.Option(False, help="Only generate input and job record."),
) -> None:
    settings = get_settings()
    selected_engine = engine or settings.default_download_engine
    result = run_download(selected_engine, settings, limit, dry_run)
    console.print(result)


@app.command("retry")
def retry_command(
    engine: str | None = typer.Option(None, help="gallery-dl or yt-dlp."),
    limit: int | None = typer.Option(None, help="Maximum tweets to process."),
    dry_run: bool = typer.Option(False, help="Only generate input and job record."),
) -> None:
    settings = get_settings()
    selected_engine = engine or "yt-dlp"
    result = run_download(selected_engine, settings, limit, dry_run)
    console.print(result)


@app.command("requeue")
def requeue_command(
    status: list[str] | None = typer.Option(
        None,
        "--status",
        help="Tweet status to requeue. Repeat for multiple statuses.",
    ),
    limit: int | None = typer.Option(None, help="Maximum tweets to requeue."),
) -> None:
    result = run_requeue(status, limit)
    console.print(result)


@app.command("recover-interrupted")
def recover_interrupted_command(
    timeout_minutes: int | None = typer.Option(
        None,
        help="Mark running/downloading records older than this as failed_retryable.",
    ),
) -> None:
    settings = get_settings()
    result = run_recover_interrupted(settings, timeout_minutes)
    console.print(result)


@app.command("backfill-media")
def backfill_media_command(
    full: bool = typer.Option(False, "--full", help="Confirm a full archive media scan."),
    no_normalize: bool = typer.Option(False, help="Do not move yt-dlp files into the canonical tweet directory."),
) -> None:
    if not full:
        raise typer.BadParameter("This scans the entire archive. Re-run with --full to confirm.")
    settings = get_settings()
    result = run_backfill(settings, normalize_files=not no_normalize)
    console.print(result)


@app.command("verify")
def verify_command(
    limit: int | None = typer.Option(None, help="Maximum media assets to verify."),
    full: bool = typer.Option(False, "--full", help="Confirm full archive file hash verification."),
) -> None:
    if not full:
        raise typer.BadParameter("This reads files across the entire archive. Re-run with --full to confirm.")
    result = run_verify(limit)
    console.print(result)


@app.command("export")
def export_command(
    format: str = typer.Option("csv", help="Export format. Currently only csv is supported."),
    output: Path | None = typer.Option(None, help="Output CSV path."),
    status: str | None = typer.Option("verified", help="Media status to export. Use 'all' to export every status."),
) -> None:
    if format != "csv":
        raise typer.BadParameter("Only csv export is supported in V0.")
    settings = get_settings()
    result = run_export_media(settings, output, None if status == "all" else status)
    console.print(result)


@app.command("export-failures")
def export_failures_command(
    output: Path | None = typer.Option(None, help="Output failures CSV path."),
) -> None:
    settings = get_settings()
    result = run_export_failures(settings, output)
    console.print(result)


@app.command("export-duplicates")
def export_duplicates_command(
    output: Path | None = typer.Option(None, help="Output duplicate media CSV path."),
) -> None:
    settings = get_settings()
    result = run_export_duplicates(settings, output)
    console.print(result)


@app.command("export-gallery")
def export_gallery_command(
    output: Path | None = typer.Option(None, help="Output HTML path."),
    status: str | None = typer.Option(
        "verified", help="Media status to export. Use 'all' to export every status."
    ),
) -> None:
    settings = get_settings()
    result = export_media_gallery(settings.archive_dir, output, None if status == "all" else status)
    console.print(result)


@app.command("serve")
def serve_command(
    host: str | None = typer.Option(None, help="API host. Defaults to API_HOST or 127.0.0.1."),
    port: int | None = typer.Option(None, help="API port. Defaults to API_PORT or 8000."),
    reload: bool = typer.Option(False, help="Enable uvicorn reload for local development."),
) -> None:
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "xarchiver.api.app:app",
        host=host or settings.api_host,
        port=port or settings.api_port,
        reload=reload,
    )


if __name__ == "__main__":
    app()
