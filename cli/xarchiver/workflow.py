from __future__ import annotations

from pathlib import Path

from xarchiver.config import Settings
from xarchiver.downloader import download
from xarchiver.importer import import_jsonl_scoped, import_urls_scoped
from xarchiver.recovery import recover_interrupted_runs
from xarchiver.services.library import get_library_snapshot
from xarchiver.verifier import verify_media_assets


def archive_urls(path: Path, settings: Settings, limit: int | None = None) -> dict[str, object]:
    recovery_result = recover_interrupted_runs(settings.stuck_timeout_minutes)
    import_result = import_urls_scoped(path)
    return archive_imported(path, "urls", import_result, recovery_result, settings, limit)


def archive_jsonl(path: Path, settings: Settings, limit: int | None = None) -> dict[str, object]:
    recovery_result = recover_interrupted_runs(settings.stuck_timeout_minutes)
    import_result = import_jsonl_scoped(path)
    return archive_imported(path, "jsonl", import_result, recovery_result, settings, limit)


def archive_imported(
    path: Path,
    input_type: str,
    import_result: dict[str, object],
    recovery_result: dict[str, int],
    settings: Settings,
    limit: int | None = None,
) -> dict[str, object]:
    tweet_ids = list(import_result["tweet_ids"])
    gallery_result = download("gallery-dl", settings, limit, dry_run=False, tweet_ids=tweet_ids)
    fallback_result = download("yt-dlp", settings, limit, dry_run=False, tweet_ids=tweet_ids)
    media_ids = sorted(set(download_media_ids(gallery_result) + download_media_ids(fallback_result)))
    downloaded_tweet_ids = sorted(
        set(download_tweet_ids(gallery_result) + download_tweet_ids(fallback_result))
    )
    verify_result = verify_media_assets(media_ids=media_ids)

    return {
        "pipeline_version": "incremental-v1",
        "scope": "input",
        "input_path": path.as_posix(),
        "input_type": input_type,
        "recovery": recovery_result,
        "input": import_result,
        "download": {
            "download_candidate_count": gallery_result.get("count", 0),
            "gallery_dl_candidate_count": gallery_result.get("count", 0),
            "yt_dlp_candidate_count": fallback_result.get("count", 0),
            "downloaded_tweet_count": len(downloaded_tweet_ids),
            "gallery_dl": summarize_download_result(gallery_result),
            "yt_dlp": summarize_download_result(fallback_result),
        },
        "media": {
            "backfilled_media_count": len(media_ids),
            "verified_media_count": verify_result["verified"],
            "missing_media_count": verify_result["missing"],
            "corrupt_media_count": verify_result["corrupt"],
        },
        "library_snapshot": get_library_snapshot(),
    }


def summarize_download_result(result: dict[str, object]) -> dict[str, object]:
    return {
        "job_id": result.get("job_id"),
        "count": result.get("count", 0),
        "exit_code": result.get("exit_code"),
        "media_backfill": result.get("media_backfill"),
    }


def download_media_ids(result: dict[str, object]) -> list[int]:
    backfill = result.get("media_backfill")
    if not isinstance(backfill, dict):
        return []
    return [int(value) for value in backfill.get("media_ids", [])]


def download_tweet_ids(result: dict[str, object]) -> list[str]:
    backfill = result.get("media_backfill")
    if not isinstance(backfill, dict):
        return []
    return [str(value) for value in backfill.get("tweet_ids", [])]
