"""旧式归档工作流编排函数。

负责把导入、下载、回填、校验串成一条增量流水线，主要供 CLI 场景复用。
"""

from __future__ import annotations

from pathlib import Path

from xarchiver.config import Settings
from xarchiver.downloader import download
from xarchiver.importer import import_jsonl_scoped, import_urls_scoped
from xarchiver.recovery import recover_interrupted_runs
from xarchiver.services.library import get_library_snapshot
from xarchiver.verifier import verify_media_assets


def archive_urls(path: Path, settings: Settings, limit: int | None = None) -> dict[str, object]:
    """导入 URL 文件后执行一轮完整归档流水线。"""

    recovery_result = recover_interrupted_runs(settings.stuck_timeout_minutes)
    import_result = import_urls_scoped(path)
    return archive_imported(path, "urls", import_result, recovery_result, settings, limit)


def archive_jsonl(path: Path, settings: Settings, limit: int | None = None) -> dict[str, object]:
    """导入 JSONL 文件后执行一轮完整归档流水线。"""

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
    """把导入摘要与下载/校验流水线结果组装成统一输出。"""

    tweet_ids = list(import_result["tweet_ids"])
    pipeline = process_tweet_scope(tweet_ids, settings, limit)
    return {
        "pipeline_version": "incremental-v1",
        "scope": "input",
        "input_path": path.as_posix(),
        "input_type": input_type,
        "recovery": recovery_result,
        "input": import_result,
        **pipeline,
    }


def process_tweet_scope(
    tweet_ids: list[str],
    settings: Settings,
    limit: int | None = None,
    archive_run_id: int | None = None,
    item_ids: dict[str, int] | None = None,
    use_download_archive: bool = True,
) -> dict[str, object]:
    """对一批 tweet 执行 gallery-dl、yt-dlp、回填与校验。"""

    gallery_result = download(
        "gallery-dl",
        settings,
        limit,
        dry_run=False,
        tweet_ids=tweet_ids,
        archive_run_id=archive_run_id,
        run_item_ids=item_ids,
        use_download_archive=use_download_archive,
    )
    gallery_downloaded_tweet_ids = set(download_tweet_ids(gallery_result))
    fallback_tweet_ids = [tweet_id for tweet_id in tweet_ids if tweet_id not in gallery_downloaded_tweet_ids]
    if fallback_tweet_ids:
        fallback_result = download(
            "yt-dlp",
            settings,
            limit,
            dry_run=False,
            tweet_ids=fallback_tweet_ids,
            archive_run_id=archive_run_id,
            run_item_ids=item_ids,
            use_download_archive=use_download_archive,
        )
    else:
        fallback_result = empty_download_result()
    media_ids = sorted(set(download_media_ids(gallery_result) + download_media_ids(fallback_result)))
    downloaded_tweet_ids = sorted(
        set(download_tweet_ids(gallery_result) + download_tweet_ids(fallback_result))
    )
    verify_result = verify_media_assets(media_ids=media_ids)

    return {
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
    """提取下载结果中与上层展示相关的摘要字段。"""

    return {
        "job_id": result.get("job_id"),
        "count": result.get("count", 0),
        "exit_code": result.get("exit_code"),
        "media_backfill": result.get("media_backfill"),
    }


def empty_download_result() -> dict[str, object]:
    """表示无需启动 fallback 下载器的空结果，不创建下载 Job。"""

    return {
        "job_id": None,
        "count": 0,
        "downloaded_tweet_ids": [],
        "media_backfill": {"media_ids": [], "tweet_ids": []},
    }


def download_media_ids(result: dict[str, object]) -> list[int]:
    """从下载结果中提取回填得到的 media_id 列表。"""

    backfill = result.get("media_backfill")
    if not isinstance(backfill, dict):
        return []
    return [int(value) for value in backfill.get("media_ids", [])]


def download_tweet_ids(result: dict[str, object]) -> list[str]:
    """从下载结果中提取回填得到的 tweet_id 列表。"""

    downloaded_tweet_ids = result.get("downloaded_tweet_ids")
    if isinstance(downloaded_tweet_ids, list):
        return [str(value) for value in downloaded_tweet_ids]
    backfill = result.get("media_backfill")
    if not isinstance(backfill, dict):
        return []
    return [str(value) for value in backfill.get("tweet_ids", [])]
