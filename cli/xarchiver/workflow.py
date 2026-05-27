from __future__ import annotations

from pathlib import Path

from xarchiver.config import Settings
from xarchiver.downloader import download
from xarchiver.exporter import export_failures_csv, export_media_csv
from xarchiver.importer import import_jsonl, import_urls
from xarchiver.media import backfill_media_assets
from xarchiver.recovery import recover_interrupted_runs
from xarchiver.verifier import verify_media_assets


def archive_urls(path: Path, settings: Settings, limit: int | None = None) -> dict[str, object]:
    recovery_result = recover_interrupted_runs(settings.stuck_timeout_minutes)
    imported_count = import_urls(path)
    return archive_imported(path, "urls", imported_count, recovery_result, settings, limit)


def archive_jsonl(path: Path, settings: Settings, limit: int | None = None) -> dict[str, object]:
    recovery_result = recover_interrupted_runs(settings.stuck_timeout_minutes)
    imported_count = import_jsonl(path)
    return archive_imported(path, "jsonl", imported_count, recovery_result, settings, limit)


def archive_imported(
    path: Path,
    input_type: str,
    imported_count: int,
    recovery_result: dict[str, int],
    settings: Settings,
    limit: int | None = None,
) -> dict[str, object]:
    gallery_result = download("gallery-dl", settings, limit, dry_run=False)
    fallback_result = download("yt-dlp", settings, limit, dry_run=False)
    backfill_result = backfill_media_assets(settings.archive_dir)
    verify_result = verify_media_assets()
    media_export = export_media_csv(settings.archive_dir)
    failures_export = export_failures_csv(settings.archive_dir)

    return {
        "input_path": path.as_posix(),
        "input_type": input_type,
        "recovery": recovery_result,
        "imported": imported_count,
        "gallery_dl": summarize_download_result(gallery_result),
        "yt_dlp": summarize_download_result(fallback_result),
        "backfill": backfill_result,
        "verify": verify_result,
        "media_csv": media_export,
        "failures_csv": failures_export,
    }


def summarize_download_result(result: dict[str, object]) -> dict[str, object]:
    return {
        "job_id": result.get("job_id"),
        "count": result.get("count", 0),
        "exit_code": result.get("exit_code"),
        "media_backfill": result.get("media_backfill"),
    }
