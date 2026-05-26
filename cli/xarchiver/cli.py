from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from xarchiver.archive import ensure_archive_dirs
from xarchiver.config import get_settings
from xarchiver.downloader import download as run_download
from xarchiver.importer import import_jsonl, import_urls
from xarchiver.migrations import migrate
from xarchiver.status import get_media_count, get_status_counts

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
        console.print(f"No migration files found in {settings.sql_dir}")
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


@app.command("verify")
def verify_command() -> None:
    console.print("verify is planned for V0.1 after downloader output contract is validated.")


@app.command("export")
def export_command(format: str = typer.Option("csv", help="Export format.")) -> None:
    console.print(f"export --format {format} is planned for V0.1.")


if __name__ == "__main__":
    app()
