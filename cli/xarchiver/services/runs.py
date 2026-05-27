from __future__ import annotations

from pathlib import Path

from xarchiver.config import Settings
from xarchiver.downloader import download
from xarchiver.exporter import export_duplicates_csv, export_failures_csv, export_media_csv
from xarchiver.importer import import_jsonl, import_urls
from xarchiver.media import backfill_media_assets
from xarchiver.recovery import recover_interrupted_runs, requeue_tweets
from xarchiver.verifier import verify_media_assets
from xarchiver.workflow import archive_urls


def run_archive_urls(path: Path, settings: Settings, limit: int | None = None) -> dict[str, object]:
    return archive_urls(path, settings, limit)


def run_import(path: Path) -> dict[str, object]:
    if path.suffix.lower() == ".jsonl":
        return {"imported": import_jsonl(path), "format": "jsonl"}
    return {"imported": import_urls(path), "format": "urls"}


def run_download(
    engine: str,
    settings: Settings,
    limit: int | None = None,
    dry_run: bool = False,
) -> dict[str, object]:
    return download(engine, settings, limit, dry_run)


def run_backfill(settings: Settings, normalize_files: bool = True) -> dict[str, object]:
    return backfill_media_assets(settings.archive_dir, normalize_files=normalize_files)


def run_verify(limit: int | None = None) -> dict[str, int]:
    return verify_media_assets(limit)


def run_requeue(statuses: list[str] | None = None, limit: int | None = None) -> dict[str, object]:
    return requeue_tweets(statuses, limit)


def run_recover_interrupted(settings: Settings, timeout_minutes: int | None = None) -> dict[str, int]:
    return recover_interrupted_runs(timeout_minutes or settings.stuck_timeout_minutes)


def run_export_media(
    settings: Settings,
    output_path: Path | None = None,
    status: str | None = "verified",
) -> dict[str, object]:
    return export_media_csv(settings.archive_dir, output_path, status)


def run_export_failures(settings: Settings, output_path: Path | None = None) -> dict[str, object]:
    return export_failures_csv(settings.archive_dir, output_path)


def run_export_duplicates(settings: Settings, output_path: Path | None = None) -> dict[str, object]:
    return export_duplicates_csv(settings.archive_dir, output_path)
