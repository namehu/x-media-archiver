"""顶层维护与导出命令的轻量服务封装。"""

from __future__ import annotations

from pathlib import Path

from xarchiver.config import Settings
from xarchiver.downloader import download
from xarchiver.exporter import export_duplicates_csv, export_failures_csv, export_media_csv
from xarchiver.importer import import_jsonl, import_urls
from xarchiver.media import backfill_media_assets
from xarchiver.recovery import recover_interrupted_runs
from xarchiver.services.hashtags import run_hashtag_backfill as execute_hashtag_backfill
from xarchiver.services.queue import submit_jsonl_file, submit_requeue_batch, submit_urls_file
from xarchiver.verifier import verify_media_assets


def run_archive_urls(path: Path, settings: Settings, limit: int | None = None) -> dict[str, object]:
    """把纯 URL 文本文件加入归档队列。"""

    del settings, limit
    return submit_urls_file(path)


def run_archive_file(path: Path, settings: Settings, limit: int | None = None) -> dict[str, object]:
    """根据文件类型把导入文件分发到正确的入队路径。"""

    del settings, limit
    if path.suffix.lower() == ".jsonl":
        return submit_jsonl_file(path)
    return submit_urls_file(path)


def run_import(path: Path) -> dict[str, object]:
    """只导入推文记录到数据库，不触发下载入队。"""

    if path.suffix.lower() == ".jsonl":
        return {"imported": import_jsonl(path), "format": "jsonl"}
    return {"imported": import_urls(path), "format": "urls"}


def run_download(
    engine: str,
    settings: Settings,
    limit: int | None = None,
    dry_run: bool = False,
) -> dict[str, object]:
    """直接执行下载器入口。"""

    return download(engine, settings, limit, dry_run)


def run_backfill(
    settings: Settings,
    normalize_files: bool = True,
    tweet_ids: list[str] | None = None,
) -> dict[str, object]:
    """基于归档目录中已存在的文件执行回填。"""

    return backfill_media_assets(settings.archive_dir, normalize_files=normalize_files, tweet_ids=tweet_ids)


def run_hashtag_backfill(
    settings: Settings,
    *,
    apply: bool = False,
    confirm_apply: bool = False,
    batch_size: int = 500,
) -> dict[str, object]:
    """显式扫描已登记的 gallery-dl 元数据并维护平台 Hashtag。"""

    return execute_hashtag_backfill(
        settings,
        apply=apply,
        confirm_apply=confirm_apply,
        batch_size=batch_size,
    )


def run_verify(limit: int | None = None, media_ids: list[int] | None = None) -> dict[str, int]:
    """校验归档媒体文件及其元数据完整性。"""

    return verify_media_assets(limit, media_ids)


def run_requeue(statuses: list[str] | None = None, limit: int | None = None) -> dict[str, object]:
    """把指定可重试状态的推文批量重新入队。"""

    return submit_requeue_batch(statuses or ["failed_retryable", "missing", "corrupt"], limit)


def run_recover_interrupted(settings: Settings, timeout_minutes: int | None = None) -> dict[str, int]:
    """按配置或指定超时阈值恢复中断的运行。"""

    return recover_interrupted_runs(timeout_minutes or settings.stuck_timeout_minutes)


def run_export_media(
    settings: Settings,
    output_path: Path | None = None,
    status: str | None = "verified",
) -> dict[str, object]:
    """把媒体记录导出为 CSV。"""

    return export_media_csv(settings.archive_dir, output_path, status)


def run_export_failures(settings: Settings, output_path: Path | None = None) -> dict[str, object]:
    """把失败记录导出为 CSV。"""

    return export_failures_csv(settings.archive_dir, output_path)


def run_export_duplicates(settings: Settings, output_path: Path | None = None) -> dict[str, object]:
    """把重复媒体分组导出为 CSV。"""

    return export_duplicates_csv(settings.archive_dir, output_path)
