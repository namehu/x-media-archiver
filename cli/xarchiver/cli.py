from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from xarchiver.archive import ensure_archive_dirs
from xarchiver.config import get_settings
from xarchiver.downloader import download as run_download
from xarchiver.exporter import export_duplicates_csv, export_media_csv, export_media_gallery, fetch_duplicate_rows
from xarchiver.importer import import_jsonl, import_urls
from xarchiver.media import backfill_media_assets
from xarchiver.migrations import migrate
from xarchiver.recovery import recover_interrupted_runs, requeue_tweets
from xarchiver.search import compact_text, search_media
from xarchiver.status import get_media_count, get_status_counts
from xarchiver.verifier import verify_media_assets
from xarchiver.workflow import archive_urls

app = typer.Typer(help="Local-first X/Twitter media archiver.")
db_app = typer.Typer(help="Database commands.")
app.add_typer(db_app, name="db")

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
    limit: int | None = typer.Option(None, help="Maximum pending tweets per downloader pass."),
) -> None:
    settings = get_settings()
    result = archive_urls(path, settings, limit)
    console.print(result)


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
    rows = fetch_duplicate_rows()
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
    result = requeue_tweets(status, limit)
    console.print(result)


@app.command("recover-interrupted")
def recover_interrupted_command(
    timeout_minutes: int | None = typer.Option(
        None,
        help="Mark running/downloading records older than this as failed_retryable.",
    ),
) -> None:
    settings = get_settings()
    result = recover_interrupted_runs(timeout_minutes or settings.stuck_timeout_minutes)
    console.print(result)


@app.command("backfill-media")
def backfill_media_command(
    no_normalize: bool = typer.Option(False, help="Do not move yt-dlp files into the canonical tweet directory."),
) -> None:
    settings = get_settings()
    result = backfill_media_assets(settings.archive_dir, normalize_files=not no_normalize)
    console.print(result)


@app.command("verify")
def verify_command(
    limit: int | None = typer.Option(None, help="Maximum media assets to verify."),
) -> None:
    result = verify_media_assets(limit)
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
    result = export_media_csv(settings.archive_dir, output, None if status == "all" else status)
    console.print(result)


@app.command("export-failures")
def export_failures_command(
    output: Path | None = typer.Option(None, help="Output failures CSV path."),
) -> None:
    from xarchiver.exporter import export_failures_csv

    settings = get_settings()
    result = export_failures_csv(settings.archive_dir, output)
    console.print(result)


@app.command("export-duplicates")
def export_duplicates_command(
    output: Path | None = typer.Option(None, help="Output duplicate media CSV path."),
) -> None:
    settings = get_settings()
    result = export_duplicates_csv(settings.archive_dir, output)
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


if __name__ == "__main__":
    app()
