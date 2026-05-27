from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from xarchiver.archive import ensure_archive_dirs
from xarchiver.config import get_settings
from xarchiver.downloader import download as run_download
from xarchiver.exporter import export_media_csv, export_media_gallery
from xarchiver.importer import import_jsonl, import_urls
from xarchiver.media import backfill_media_assets
from xarchiver.migrations import migrate
from xarchiver.recovery import requeue_tweets
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
