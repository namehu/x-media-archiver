"""下载器编排与进度采集辅助函数。

这个模块负责挑选待下载 tweet、构造 gallery-dl / yt-dlp 命令、采集
运行进度、记录 download_jobs / download_attempts，并在结束后触发媒体回填。
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
import time
from collections import Counter, deque
from dataclasses import dataclass, field
from pathlib import Path
from queue import Empty, Full, Queue
from threading import Event, Lock, Thread

from sqlalchemy import and_, bindparam, func, literal_column, or_, select
from sqlalchemy.sql import ColumnElement

from xarchiver.archive import ensure_archive_dirs, normalize_path
from xarchiver.config import Settings
from xarchiver.core.errors import (
    PERMANENT_DOWNLOAD_CATEGORIES,
    ErrorCategory,
    category_value,
    classify_x_error,
)
from xarchiver.core.events import publish_event
from xarchiver.core.subprocesses import stop_process_group
from xarchiver.db import connect
from xarchiver.media import backfill_media_assets
from xarchiver.row_models import DownloadCandidateRow, IdRow
from xarchiver.services.cookies import resolve_cookie_content
from xarchiver.services.hashtags import gallery_dl_compatibility, sync_registered_gallery_hashtags
from xarchiver.services.operation_logs import (
    append_operation_log_entries,
    append_operation_log_entry,
    close_operation_log_stream,
    create_operation_log_stream,
    parse_gallery_dl_log_level,
    redact_sensitive_text,
)
from xarchiver.sql_builder import compile_query
from xarchiver.tables import tweets

SUPPORTED_ENGINES = {"gallery-dl", "yt-dlp"}
logger = logging.getLogger(__name__)
YTDLP_PROGRESS_PREFIX = "xarchiver-progress:"
YTDLP_PROGRESS_RE = re.compile(
    rf"{re.escape(YTDLP_PROGRESS_PREFIX)}"
    r"(?P<tweet_id>[^|]*)\|(?P<status>[^|]*)\|(?P<downloaded>[^|]*)\|(?P<total>[^|]*)\|(?P<estimate>[^|]*)\|(?P<speed>[^|]*)"
)
GALLERY_DL_PROGRESS_PREFIX = "xarchiver-gdl:"
GALLERY_DL_FILE_RE = re.compile(
    rf"{re.escape(GALLERY_DL_PROGRESS_PREFIX)}(?P<event>start|success|skip)\|(?P<filename>.*)"
)
GALLERY_DL_PROGRESS_RE = re.compile(
    rf"{re.escape(GALLERY_DL_PROGRESS_PREFIX)}progress\|"
    r"(?P<downloaded>[^|]*)\|(?P<speed>[^|]*)\|(?P<total>[^|]*)\|(?P<percent>[^|]*)"
)
GALLERY_DL_SIZE_RE = re.compile(
    r"^(?P<value>\d+(?:\.\d+)?)(?P<unit>[KMGTPEZY]?)(?P<binary>i?)$",
    re.IGNORECASE,
)
TWEET_STATUS_URL_RE = re.compile(
    r"https?://(?:www\.)?(?:x|twitter)\.com/[^\s/]+/status/(?P<tweet_id>\d+)"
)
YTDLP_TWEET_ERROR_RE = re.compile(r"\[twitter\]\s+(?P<tweet_id>\d+):", re.IGNORECASE)
GALLERY_DL_OUTPUT_MODE = {
    "start": f"{GALLERY_DL_PROGRESS_PREFIX}start|{{}}\n",
    "success": f"{GALLERY_DL_PROGRESS_PREFIX}success|{{}}\n",
    "skip": f"{GALLERY_DL_PROGRESS_PREFIX}skip|{{}}\n",
    "progress": f"{GALLERY_DL_PROGRESS_PREFIX}progress|{{0}}|{{1}}|0|0\n",
    "progress-total": f"{GALLERY_DL_PROGRESS_PREFIX}progress|{{0}}|{{1}}|{{2}}|{{3}}\n",
}
DOWNLOAD_LOG_BATCH_SIZE = 100
DOWNLOAD_LOG_QUEUE_SIZE = 1000
DOWNLOAD_LOG_QUEUE_PUT_TIMEOUT_SECONDS = 0.1
DOWNLOAD_PROCESS_STOP_TIMEOUT_SECONDS = 5.0
DOWNLOAD_READER_DRAIN_TIMEOUT_SECONDS = 10.0
DOWNLOAD_READER_JOIN_TIMEOUT_SECONDS = 5.0
DOWNLOAD_STDOUT_TAIL_CHARS = 16_384
DOWNLOAD_STDERR_TAIL_CHARS = 65_536
PROGRESS_THROTTLE_SECONDS = 0.75


@dataclass
class DownloadProgressState:
    """下载过程中的瞬时进度状态。"""

    native_progress_seen: bool = False
    last_native_progress_at: float | None = None
    current_tweet_id: str | None = None
    current_path: Path | None = None
    previous_bytes: int = 0
    previous_sample_at: float | None = None
    last_fallback_scan_at: float | None = None
    completed_bytes_by_tweet: dict[str, int] = field(default_factory=dict)
    completed_paths: set[Path] = field(default_factory=set)
    last_progress_flush_at: float | None = None
    last_progress_flush_tweet_id: str | None = None
    flushed_progress_item_ids: set[int] = field(default_factory=set)
    pending_progress_by_tweet: dict[str, dict[str, int]] = field(default_factory=dict)
    pending_progress_message: str | None = None
    pending_current_tweet_id: str | None = None


class TextTailBuffer:
    """Keep a bounded text tail without retaining the full subprocess output."""

    def __init__(self, max_chars: int):
        self.max_chars = max_chars
        self.chunks: deque[str] = deque()
        self.char_count = 0

    def append(self, value: str) -> None:
        if len(value) >= self.max_chars:
            self.chunks.clear()
            tail = value[-self.max_chars :]
            self.chunks.append(tail)
            self.char_count = len(tail)
            return
        self.chunks.append(value)
        self.char_count += len(value)
        while self.char_count > self.max_chars and self.chunks:
            overflow = self.char_count - self.max_chars
            first = self.chunks[0]
            if len(first) <= overflow:
                self.chunks.popleft()
                self.char_count -= len(first)
                continue
            self.chunks[0] = first[overflow:]
            self.char_count -= overflow

    def getvalue(self) -> str:
        return "".join(self.chunks)


def download(
    engine: str,
    settings: Settings,
    limit: int | None,
    dry_run: bool,
    tweet_ids: list[str] | None = None,
    archive_run_id: int | None = None,
    run_item_ids: dict[str, int] | None = None,
    use_download_archive: bool = True,
) -> dict[str, object]:
    """执行一次下载任务，并把结果回写到数据库。"""

    if engine not in SUPPORTED_ENGINES:
        raise ValueError(f"Unsupported engine: {engine}")

    ensure_archive_dirs(settings.archive_dir)
    tweets = fetch_download_candidates(
        limit,
        None if archive_run_id is not None else settings.retry_limit,
        0 if archive_run_id is not None else settings.retry_backoff_minutes,
        tweet_ids,
    )
    input_path = write_input_file(settings.archive_dir, engine, [tweet["url"] for tweet in tweets])

    job_id = create_job(
        engine,
        input_path,
        len(tweets),
        "dry_run" if dry_run else "running",
        archive_run_id,
    )
    log_stream_id = get_download_job_log_stream_id(job_id)
    append_download_log(
        log_stream_id,
        "info",
        "download",
        "下载任务已创建。",
        context={
            "engine": engine,
            "tweet_count": len(tweets),
            "dry_run": dry_run,
            "download_archive_enabled": use_download_archive,
        },
    )
    log_download_event(
        "download.job.started",
        job_id=job_id,
        engine=engine,
        tweet_count=len(tweets),
        dry_run=dry_run,
        archive_run_id=archive_run_id,
    )
    if dry_run or not tweets:
        finish_job(job_id, "dry_run", 0, 0, None)
        log_download_event(
            "download.job.completed",
            job_id=job_id,
            engine=engine,
            status="dry_run",
            success_count=0,
            failed_count=0,
            tweet_count=len(tweets),
            dry_run=True,
        )
        return {
            "job_id": job_id,
            "input_path": input_path,
            "count": len(tweets),
            "dry_run": True,
            "media_backfill": empty_backfill_result(),
        }

    cookie_path = prepare_cookies(settings)
    cookie_error = validate_cookie_file(engine, cookie_path)
    if cookie_error:
        category = ErrorCategory.AUTH_REQUIRED.value
        mark_attempts(
            job_id,
            tweets,
            engine,
            "failed_retryable",
            0,
            category,
            cookie_error,
            run_item_ids,
        )
        mark_tweets_failed([tweet["tweet_id"] for tweet in tweets], "failed_retryable", category)
        append_download_log(log_stream_id, "error", "download", f"Cookies 校验失败: {cookie_error}")
        finish_job(job_id, "failed", 0, len(tweets), category)
        log_download_event(
            "download.job.failed",
            job_id=job_id,
            engine=engine,
            status="failed",
            error_category=category,
            failed_count=len(tweets),
        )
        return {
            "job_id": job_id,
            "input_path": input_path,
            "count": len(tweets),
            "exit_code": 0,
        }

    # 先准备好下载器命令；如果命令不存在，则在真正启动前快速失败。
    command = build_command(
        engine,
        settings,
        input_path,
        cookie_path,
        use_download_archive=use_download_archive,
    )
    executable = command[0]
    if shutil.which(executable) is None:
        category = ErrorCategory.COMMAND_NOT_FOUND.value
        mark_attempts(
            job_id,
            tweets,
            engine,
            "failed_retryable",
            127,
            category,
            executable,
            run_item_ids,
        )
        mark_tweets_failed([tweet["tweet_id"] for tweet in tweets], "failed_retryable", category)
        append_download_log(log_stream_id, "error", "download", f"下载器未安装: {executable}")
        finish_job(job_id, "failed", 0, len(tweets), f"{executable} not found")
        log_download_event(
            "download.job.failed",
            job_id=job_id,
            engine=engine,
            status="failed",
            error_category=category,
            failed_count=len(tweets),
            exit_code=127,
        )
        return {
            "job_id": job_id,
            "input_path": input_path,
            "count": len(tweets),
            "exit_code": 127,
        }

    set_tweets_downloading([tweet["tweet_id"] for tweet in tweets])
    log_download_event(
        "download.command.started",
        job_id=job_id,
        engine=engine,
        tweet_count=len(tweets),
    )
    append_download_log(log_stream_id, "info", "download", f"启动 {engine} 下载器。")
    mark_run_items_progress(job_id, tweets, run_item_ids, f"{engine} 下载中")
    # 运行下载器并持续采集进度；成功后再做媒体回填。
    try:
        result = run_command_with_progress(command, settings, job_id, tweets, run_item_ids, engine, log_stream_id)
    except Exception as exc:
        append_download_log(log_stream_id, "error", "download", "下载器进程异常退出。", exception=exc)
        finish_job(job_id, "failed", 0, len(tweets), ErrorCategory.WORKER_ERROR.value)
        raise
    raw_stderr = result.stderr or ""
    mark_run_items_progress(job_id, tweets, run_item_ids, "下载器完成，正在回填媒体")
    append_download_log(
        log_stream_id,
        "info" if result.returncode == 0 else "warning",
        "download",
        "下载器已结束，开始回填本批已落盘媒体。",
        context={"exit_code": result.returncode},
    )
    # 下载器允许混合批次部分成功。无论整体退出码如何，都必须先回填本批
    # 已落盘文件，再按 Tweet 结果决定 fallback 和错误状态。
    backfill_result = backfill_media_assets(
        settings.archive_dir,
        tweet_ids=[tweet["tweet_id"] for tweet in tweets],
    )
    downloaded_ids = backfilled_tweet_ids_for_engine(backfill_result, engine)
    downloaded = [tweet for tweet in tweets if tweet["tweet_id"] in downloaded_ids]
    missing = [tweet for tweet in tweets if tweet["tweet_id"] not in downloaded_ids]
    hashtag_result = sync_gallery_hashtags_after_backfill(
        settings,
        engine,
        engine_backfill_result(backfill_result, engine),
        log_stream_id,
    )
    if hashtag_result is not None:
        backfill_result["hashtags"] = hashtag_result
    media_sizes = fetch_media_sizes([tweet["tweet_id"] for tweet in tweets])
    append_download_log(
        log_stream_id,
        "info" if not missing else "warning",
        "download",
        "媒体回填完成。",
        context={"downloaded_count": len(downloaded), "missing_count": len(missing)},
    )
    mark_run_items_finished(downloaded, run_item_ids, media_sizes, "下载完成，等待校验")
    mark_attempts(
        job_id,
        downloaded,
        engine,
        "downloaded",
        result.returncode,
        None,
        None,
        run_item_ids,
    )
    mark_tweets_downloaded([tweet["tweet_id"] for tweet in downloaded])

    failure_details = classify_missing_tweets(missing, result.returncode, raw_stderr)
    for tweet in missing:
        tweet_id = str(tweet["tweet_id"])
        detail = failure_details[tweet_id]
        mark_attempts(
            job_id,
            [tweet],
            engine,
            detail["status"],
            result.returncode,
            detail["category"],
            detail["stderr_excerpt"],
            run_item_ids,
        )
        mark_tweets_failed([tweet_id], detail["status"], detail["category"])
        mark_run_items_progress(
            job_id,
            [tweet],
            run_item_ids,
            f"下载失败: {detail['category']}",
            downloaded_bytes=0,
            total_bytes=0,
            speed_bps=0,
            apply_to_all_items=True,
        )

    job_category = summarize_failure_category(failure_details)
    status = "finished" if not missing else "partial" if downloaded else "failed"
    finish_job(job_id, status, len(downloaded), len(missing), job_category)
    log_download_event(
        "download.job.completed" if downloaded or not missing else "download.job.failed",
        job_id=job_id,
        engine=engine,
        status=status,
        exit_code=result.returncode,
        success_count=len(downloaded),
        failed_count=len(missing),
        error_category=job_category,
    )

    return {
        "job_id": job_id,
        "input_path": input_path,
        "count": len(tweets),
        "exit_code": result.returncode,
        "downloaded_tweet_ids": sorted(downloaded_ids),
        "media_backfill": backfill_result,
    }


def sync_gallery_hashtags_after_backfill(
    settings: Settings,
    engine: str,
    backfill_result: dict[str, object],
    log_stream_id: int | None,
) -> dict[str, int] | None:
    """尽力补充平台 Hashtag；任何异常都不得改变媒体回填结果。"""

    if engine != "gallery-dl":
        return None
    try:
        compatibility = gallery_dl_compatibility()
        result = sync_registered_gallery_hashtags(
            settings.archive_dir,
            tweet_ids=[str(value) for value in backfill_result.get("tweet_ids", [])],
            gallery_dl_version=(
                str(compatibility["installed_version"])
                if compatibility.get("installed_version")
                else None
            ),
        )
    except Exception as exc:
        logger.warning(
            "Gallery-dl hashtag extraction failed without affecting media backfill.",
            exc_info=True,
        )
        append_hashtag_download_log_best_effort(
            log_stream_id,
            "warning",
            "hashtag",
            "平台 Hashtag 提取失败；媒体回填结果不受影响。",
            exception=exc,
        )
        return None

    append_hashtag_download_log_best_effort(
        log_stream_id,
        "info",
        "hashtag",
        "平台 Hashtag 增量提取完成。",
        context={
            "observed_count": result["observed_hashtag_count"],
            "inserted_count": result["inserted_relationship_count"],
            "invalid_count": result["invalid_hashtag_count"],
        },
    )
    return result


def append_hashtag_download_log_best_effort(
    log_stream_id: int | None,
    level: str,
    component: str,
    message: str,
    *,
    context: dict[str, object] | None = None,
    exception: BaseException | None = None,
) -> None:
    """Hashtag 附属日志失败也不得改变主下载流程。"""

    try:
        append_download_log(
            log_stream_id,
            level,
            component,
            message,
            context=context,
            exception=exception,
        )
    except Exception:
        logger.warning(
            "Unable to append gallery-dl hashtag log without affecting media backfill.",
            exc_info=True,
        )


def fetch_download_candidates(
    limit: int | None,
    retry_limit: int | None = None,
    retry_backoff_minutes: int = 0,
    tweet_ids: list[str] | None = None,
) -> list[DownloadCandidateRow]:
    """读取待下载 tweet 候选列表。"""

    sql, params = build_download_candidates_query(
        limit=limit,
        retry_limit=retry_limit,
        retry_backoff_minutes=retry_backoff_minutes,
        tweet_ids=tweet_ids,
    )

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [DownloadCandidateRow.model_validate(dict(row)) for row in cur.fetchall()]


def build_download_candidates_query(
    limit: int | None,
    retry_limit: int | None = None,
    retry_backoff_minutes: int = 0,
    tweet_ids: list[str] | None = None,
) -> tuple[str, dict[str, object]]:
    """构造待下载候选 tweet 查询。"""

    statement = (
        select(tweets.c.tweet_id, tweets.c.url)
        .select_from(tweets)
        .where(and_(*build_download_candidate_conditions(retry_limit, retry_backoff_minutes, tweet_ids)))
        .order_by(tweets.c.imported_at.asc())
    )
    if limit:
        statement = statement.limit(bindparam("limit", limit))
    return compile_query(statement)


def build_download_candidate_conditions(
    retry_limit: int | None = None,
    retry_backoff_minutes: int = 0,
    tweet_ids: list[str] | None = None,
) -> list[ColumnElement[bool]]:
    """构造下载候选过滤条件。"""

    conditions: list[ColumnElement[bool]] = [
        tweets.c.download_status.in_(("pending", "failed_retryable", "missing", "corrupt"))
    ]
    if retry_limit is not None:
        conditions.append(tweets.c.retry_count < bindparam("retry_limit", retry_limit))
    if retry_backoff_minutes > 0:
        conditions.append(
            or_(
                tweets.c.download_status == "pending",
                tweets.c.last_attempt_at.is_(None),
                tweets.c.last_attempt_at
                <= func.now()
                - (
                    bindparam("retry_backoff_minutes", retry_backoff_minutes)
                    * func.greatest(tweets.c.retry_count, 1)
                    * literal_column("interval '1 minute'")
                ),
            )
        )
    if tweet_ids is not None:
        conditions.append(tweets.c.tweet_id.in_(tweet_ids))
    return conditions


def write_input_file(archive_dir: Path, engine: str, urls: list[str]) -> Path:
    """把待下载 URL 列表写成下载器输入文件。"""

    path = archive_dir / "raw" / "downloader_inputs" / f"{engine}-input.txt"
    path.write_text("\n".join(urls) + ("\n" if urls else ""), encoding="utf-8")
    return path


def prepare_cookies(settings: Settings) -> Path | None:
    """把当前 cookie 内容写成下载器运行时文件。"""

    cookie = resolve_cookie_content(settings)
    if cookie is None:
        return None

    runtime_cookie_file = settings.archive_dir / "state" / "runtime-cookies.txt"
    runtime_cookie_file.parent.mkdir(parents=True, exist_ok=True)
    content = cookie.content if cookie.content.endswith("\n") else f"{cookie.content}\n"
    runtime_cookie_file.write_text(content, encoding="utf-8")
    return runtime_cookie_file


def build_command(
    engine: str,
    settings: Settings,
    input_path: Path,
    cookie_path: Path | None,
    *,
    use_download_archive: bool = True,
) -> list[str]:
    """构造 gallery-dl 或 yt-dlp 命令行参数。"""

    sleep_min = format_sleep_seconds(getattr(settings, "downloader_sleep_min_seconds", 2.0))
    sleep_max = format_sleep_seconds(getattr(settings, "downloader_sleep_max_seconds", 6.0))
    sleep_range = format_sleep_range(
        getattr(settings, "downloader_sleep_min_seconds", 2.0),
        getattr(settings, "downloader_sleep_max_seconds", 6.0),
    )
    if engine == "gallery-dl":
        command = [
            "gallery-dl",
            "--config",
            "/app/gallery-dl.conf",
            "-o",
            f"extractor.twitter.cookies={cookie_path}" if cookie_path is not None else "extractor.twitter.cookies=",
            "-o",
            "extractor.twitter.cookies-update=false",
            "-o",
            f"output.mode={json.dumps(GALLERY_DL_OUTPUT_MODE, separators=(',', ':'))}",
            "-o",
            "output.ansi=false",
            "-o",
            "output.shorten=false",
            "-o",
            "downloader.progress=1.0",
            "--destination",
            str(settings.archive_dir / "media"),
            "--sleep-request",
            sleep_range,
            "--sleep",
            sleep_range,
            "--write-metadata",
        ]
        if use_download_archive:
            command.extend(
                [
                    "--download-archive",
                    str(settings.archive_dir / "state" / "gallery-dl-downloaded.txt"),
                ]
            )
        else:
            command.append("--no-skip")
        command.extend(["-i", str(input_path)])
        return command

    command = [
        "yt-dlp",
        "--newline",
        "--no-color",
        "--cookies",
        str(cookie_path) if cookie_path is not None else "",
        "--sleep-requests",
        sleep_min,
        "--sleep-interval",
        sleep_min,
        "--max-sleep-interval",
        sleep_max,
        "--write-info-json",
        "--write-thumbnail",
        "--progress-delta",
        "1",
        "--progress-template",
        f"download:{YTDLP_PROGRESS_PREFIX}%(info.display_id)s|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s",
    ]
    if use_download_archive:
        command.extend(
            [
                "--download-archive",
                str(settings.archive_dir / "state" / "yt-dlp-downloaded.txt"),
            ]
        )
    command.extend(
        [
            "-a",
            str(input_path),
            "-o",
            str(
                settings.archive_dir
                / "media"
                / "%(uploader_id)s"
                / "%(display_id)s"
                / "%(display_id)s.%(ext)s"
            ),
        ]
    )
    return command


def format_sleep_range(min_seconds: float, max_seconds: float) -> str:
    """格式化下载器接受的睡眠区间字符串。"""

    minimum = max(0.0, float(min_seconds))
    maximum = max(minimum, float(max_seconds))
    return f"{minimum:g}-{maximum:g}" if maximum > minimum else f"{minimum:g}"


def format_sleep_seconds(seconds: float) -> str:
    """格式化单个睡眠秒数字符串。"""

    return f"{max(0.0, float(seconds)):g}"


def validate_cookie_file(engine: str, cookie_file: Path | None) -> str | None:
    """校验下载器所需 cookie 文件是否存在且非空。"""

    if engine not in SUPPORTED_ENGINES:
        return None
    if cookie_file is None or not cookie_file.exists():
        return "cookie_missing"
    if cookie_file.stat().st_size == 0:
        return "cookie_empty"
    return None


def create_job(
    engine: str,
    input_path: Path,
    total_count: int,
    status: str,
    archive_run_id: int | None = None,
) -> int:
    """创建一条 download_jobs 记录。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into download_jobs (
                    job_type, engine, input_path, status, total_count, started_at, archive_run_id,
                    progress_message
                )
                values ('download', %s, %s, %s, %s, now(), %s, '等待下载器处理')
                returning id
                """,
                (engine, normalize_path(input_path), status, total_count, archive_run_id),
            )
            job_id = IdRow.model_validate(dict(cur.fetchone())).id
        conn.commit()
    log_path = download_log_relative_path(job_id)
    log_stream_id = create_operation_log_stream(
        "download_job",
        job_id,
        log_path,
        {"engine": engine, "archive_run_id": archive_run_id, "tweet_count": total_count},
    )
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("update download_jobs set log_stream_id = %s where id = %s", (log_stream_id, job_id))
        conn.commit()
    return job_id


def finish_job(job_id: int, status: str, success_count: int, failed_count: int, error: str | None) -> None:
    """收敛 download_jobs 状态与统计。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update download_jobs
                set status = %s,
                    success_count = %s,
                    failed_count = %s,
                    error_message = %s,
                    current_tweet_id = null,
                    current_file = null,
                    speed_bps = 0,
                    progress_message = case
                        when %s = 'finished' then '下载完成'
                        when %s = 'partial' then '部分完成'
                        when %s = 'failed' then '下载失败'
                        else progress_message
                    end,
                    last_progress_at = now(),
                    finished_at = now()
                where id = %s
                """,
                (status, success_count, failed_count, error, status, status, status, job_id),
            )
        conn.commit()
    log_stream_id = get_download_job_log_stream_id(job_id)
    append_download_log(
        log_stream_id,
        "error" if status == "failed" else "info",
        "download",
        f"下载任务结束: {status}。",
        context={"success_count": success_count, "failed_count": failed_count, "error_category": error},
    )
    if log_stream_id is not None:
        close_operation_log_stream(log_stream_id)


def mark_run_items_progress(
    job_id: int,
    candidate_tweets: list[dict[str, str]],
    run_item_ids: dict[str, int] | None,
    message: str,
    downloaded_bytes: int | None = None,
    total_bytes: int | None = None,
    speed_bps: int | None = None,
    apply_to_all_items: bool = False,
) -> None:
    """把批量进度摘要回写到 archive_run_items 与 download_jobs。"""

    if not candidate_tweets:
        return
    tweet_ids = [tweet["tweet_id"] for tweet in candidate_tweets]
    current_tweet_id = tweet_ids[0] if tweet_ids else None
    item_ids = [run_item_ids[tweet_id] for tweet_id in tweet_ids if run_item_ids and tweet_id in run_item_ids]
    event_payload: dict[str, object]
    with connect() as conn:
        with conn.cursor() as cur:
            if item_ids:
                if downloaded_bytes is None and total_bytes is None and speed_bps is None:
                    cur.execute(
                        """
                        update archive_run_items
                        set progress_message = %s,
                            last_progress_at = now(),
                            updated_at = now()
                        where id = any(%s)
                        """,
                        (message, item_ids),
                    )
                else:
                    numeric_item_ids = item_ids if apply_to_all_items else item_ids[:1]
                    if not apply_to_all_items and len(item_ids) > 1:
                        cur.execute(
                            """
                            update archive_run_items
                            set progress_message = %s,
                                last_progress_at = now(),
                                updated_at = now()
                            where id = any(%s)
                            """,
                            (message, item_ids),
                        )
                    cur.execute(
                        """
                        update archive_run_items
                        set downloaded_bytes = case when %s::bigint is null then downloaded_bytes else %s end,
                            total_bytes = case when %s::bigint is null then total_bytes else %s end,
                            speed_bps = case when %s::bigint is null then speed_bps else %s end,
                            progress_message = %s,
                            last_progress_at = now(),
                            updated_at = now()
                        where id = any(%s)
                        """,
                        (
                            downloaded_bytes,
                            downloaded_bytes,
                            total_bytes,
                            total_bytes,
                            speed_bps,
                            speed_bps,
                            message,
                            numeric_item_ids,
                        ),
                    )
            cur.execute(
                """
                update download_jobs
                set current_tweet_id = %s,
                    downloaded_bytes = coalesce(%s, downloaded_bytes),
                    total_bytes = coalesce(%s, total_bytes),
                    speed_bps = coalesce(%s, speed_bps),
                    progress_message = %s,
                    last_progress_at = now()
                where id = %s
                """,
                (current_tweet_id, downloaded_bytes, total_bytes, speed_bps, message, job_id),
            )
            event_payload = build_run_items_event_payload(
                cur,
                item_ids,
                job_id=job_id,
                extra={
                    "tweet_ids": tweet_ids,
                    "current_tweet_id": current_tweet_id,
                    "progress_message": message,
                    "downloaded_bytes": downloaded_bytes,
                    "total_bytes": total_bytes,
                    "speed_bps": speed_bps,
                },
            )
        conn.commit()
    publish_event(
        "archive_runs",
        "archive.run.progress",
        event_payload,
    )


def mark_run_items_finished(
    candidate_tweets: list[dict[str, str]],
    run_item_ids: dict[str, int] | None,
    media_sizes: dict[str, int],
    message: str,
) -> None:
    """把成功下载并完成回填的条目标记为已完成。"""

    if not candidate_tweets or not run_item_ids:
        return
    with connect() as conn:
        with conn.cursor() as cur:
            for tweet in candidate_tweets:
                tweet_id = tweet["tweet_id"]
                item_id = run_item_ids.get(tweet_id)
                if item_id is None:
                    continue
                size = media_sizes.get(tweet_id, 0)
                cur.execute(
                    """
                    update archive_run_items
                    set downloaded_bytes = %s,
                        total_bytes = %s,
                        speed_bps = 0,
                        progress_message = %s,
                        last_progress_at = now(),
                        updated_at = now()
                    where id = %s
                    """,
                    (size, size, message, item_id),
                )
        conn.commit()


def mark_run_items_tweet_progress(
    job_id: int,
    candidate_tweets: list[dict[str, str]],
    run_item_ids: dict[str, int] | None,
    message: str,
    progress_by_tweet: dict[str, dict[str, int]],
    current_tweet_id: str | None = None,
) -> None:
    """按 tweet 粒度回写一次进度采样，并发布整批进度事件。"""
    if not candidate_tweets or not progress_by_tweet:
        return
    rows = [
        (
            progress.get("downloaded_bytes"),
            progress.get("total_bytes"),
            progress.get("speed_bps"),
            run_item_ids[tweet_id],
        )
        for tweet_id, progress in progress_by_tweet.items()
        if run_item_ids and tweet_id in run_item_ids
    ]
    downloaded_bytes = sum(progress.get("downloaded_bytes", 0) for progress in progress_by_tweet.values())
    total_values = [progress["total_bytes"] for progress in progress_by_tweet.values() if progress.get("total_bytes", 0) > 0]
    total_bytes = sum(total_values) if total_values else None
    speed_bps = sum(progress.get("speed_bps", 0) for progress in progress_by_tweet.values())
    event_payload: dict[str, object]
    with connect() as conn:
        with conn.cursor() as cur:
            if rows:
                cur.executemany(
                    """
                    update archive_run_items
                    set downloaded_bytes = coalesce(%s, downloaded_bytes),
                        total_bytes = coalesce(%s, total_bytes),
                        speed_bps = coalesce(%s, speed_bps),
                        progress_message = %s,
                        last_progress_at = now(),
                        updated_at = now()
                    where id = %s
                    """,
                    [(downloaded, total, speed, message, item_id) for downloaded, total, speed, item_id in rows],
                )
            cur.execute(
                """
                update download_jobs
                set current_tweet_id = %s,
                    downloaded_bytes = %s,
                    total_bytes = coalesce(%s, total_bytes),
                    speed_bps = %s,
                    progress_message = %s,
                    last_progress_at = now()
                where id = %s
                """,
                (current_tweet_id, downloaded_bytes, total_bytes, speed_bps, message, job_id),
            )
            event_payload = build_run_items_event_payload(
                cur,
                [int(row[3]) for row in rows],
                job_id=job_id,
                extra={
                    "tweet_ids": list(progress_by_tweet),
                    "current_tweet_id": current_tweet_id,
                    "progress_message": message,
                    "downloaded_bytes": downloaded_bytes,
                    "total_bytes": total_bytes,
                    "speed_bps": speed_bps,
                },
            )
        conn.commit()
    publish_event(
        "archive_runs",
        "archive.run.progress",
        event_payload,
    )


def record_download_progress(
    state: DownloadProgressState,
    state_lock: Lock,
    job_id: int,
    candidate_tweets: list[dict[str, str]],
    run_item_ids: dict[str, int] | None,
    message: str,
    progress_by_tweet: dict[str, dict[str, int]],
    current_tweet_id: str | None = None,
    force: bool = False,
) -> None:
    """记录一次采样，并在共享节流窗口允许时写库和 publish。"""

    if not progress_by_tweet:
        return
    with state_lock:
        now = time.monotonic()
        for tweet_id, progress in progress_by_tweet.items():
            pending = state.pending_progress_by_tweet.setdefault(tweet_id, {})
            for key, value in progress.items():
                pending[key] = value
        state.pending_progress_message = message
        if current_tweet_id:
            state.pending_current_tweet_id = current_tweet_id

        pending_item_ids = {
            run_item_ids[tweet_id]
            for tweet_id in state.pending_progress_by_tweet
            if run_item_ids and tweet_id in run_item_ids
        }
        has_first_progress = bool(pending_item_ids - state.flushed_progress_item_ids)
        item_switched = (
            bool(current_tweet_id)
            and state.last_progress_flush_tweet_id is not None
            and current_tweet_id != state.last_progress_flush_tweet_id
        )
        interval_elapsed = (
            state.last_progress_flush_at is None
            or now - state.last_progress_flush_at >= PROGRESS_THROTTLE_SECONDS
        )
        if not (force or has_first_progress or item_switched or interval_elapsed):
            return

        flush_progress = {
            tweet_id: dict(progress)
            for tweet_id, progress in state.pending_progress_by_tweet.items()
        }
        flush_message = state.pending_progress_message or message
        flush_current_tweet_id = state.pending_current_tweet_id or current_tweet_id
        state.pending_progress_by_tweet.clear()
        state.pending_progress_message = None
        state.pending_current_tweet_id = None
        state.last_progress_flush_at = now
        if flush_current_tweet_id:
            state.last_progress_flush_tweet_id = flush_current_tweet_id
        state.flushed_progress_item_ids.update(pending_item_ids)

    mark_run_items_tweet_progress(
        job_id,
        candidate_tweets,
        run_item_ids,
        flush_message,
        flush_progress,
        current_tweet_id=flush_current_tweet_id,
    )


def flush_pending_download_progress(
    state: DownloadProgressState,
    state_lock: Lock,
    job_id: int,
    candidate_tweets: list[dict[str, str]],
    run_item_ids: dict[str, int] | None,
) -> None:
    """强制 flush 已被节流合并的最后一次采样。"""

    with state_lock:
        if not state.pending_progress_by_tweet:
            return
        progress_by_tweet = {
            tweet_id: dict(progress)
            for tweet_id, progress in state.pending_progress_by_tweet.items()
        }
        message = state.pending_progress_message or "下载器处理中"
        current_tweet_id = state.pending_current_tweet_id
        item_ids = {
            run_item_ids[tweet_id]
            for tweet_id in state.pending_progress_by_tweet
            if run_item_ids and tweet_id in run_item_ids
        }
        state.pending_progress_by_tweet.clear()
        state.pending_progress_message = None
        state.pending_current_tweet_id = None
        state.last_progress_flush_at = time.monotonic()
        if current_tweet_id:
            state.last_progress_flush_tweet_id = current_tweet_id
        state.flushed_progress_item_ids.update(item_ids)

    mark_run_items_tweet_progress(
        job_id,
        candidate_tweets,
        run_item_ids,
        message,
        progress_by_tweet,
        current_tweet_id=current_tweet_id,
    )


def build_run_items_event_payload(
    cur,
    item_ids: list[int],
    job_id: int,
    extra: dict[str, object] | None = None,
) -> dict[str, object]:
    """构造前端 runtime overlay 可直接消费的 run/item 事件载荷。"""

    payload: dict[str, object] = {"job_id": job_id}
    if extra:
        payload.update(extra)
    rows: list[dict[str, object]] = []
    if item_ids:
        cur.execute(
            """
            select i.id,
                   i.id as archive_run_item_id,
                   i.archive_run_id,
                   r.source_id,
                   r.status as archive_run_status,
                   i.tweet_id,
                   i.status,
                   i.retry_count,
                   i.error_category,
                   i.error_message,
                   i.linked_item_id,
                   i.cancel_requested,
                   i.downloaded_bytes,
                   i.total_bytes,
                   i.speed_bps,
                   i.progress_message,
                   i.last_progress_at,
                   i.last_attempt_at,
                   i.next_attempt_at,
                   i.created_at,
                   i.updated_at
            from archive_run_items i
            join archive_runs r on r.id = i.archive_run_id
            where i.id = any(%s)
            order by i.id
            """,
            (item_ids,),
        )
        rows = [dict(row) for row in cur.fetchall()]
    elif job_id:
        cur.execute(
            """
            select r.id as archive_run_id, r.source_id, r.status as archive_run_status
            from download_jobs j
            join archive_runs r on r.id = j.archive_run_id
            where j.id = %s
            """,
            (job_id,),
        )
        row = cur.fetchone()
        if row:
            payload.update(dict(row))

    if rows:
        first = rows[0]
        run_id = int(first["archive_run_id"])
        payload.update(
            {
                "run_id": run_id,
                "archive_run_id": run_id,
                "source_id": first.get("source_id"),
                "run": {
                    "id": run_id,
                    "source_id": first.get("source_id"),
                    "status": first.get("archive_run_status"),
                    "speed_bps": payload.get("speed_bps"),
                },
                "items": rows,
            }
        )
    else:
        payload.setdefault("items", [])
        archive_run_id = payload.get("archive_run_id")
        if archive_run_id is not None:
            payload.setdefault("run_id", archive_run_id)
            payload.setdefault(
                "run",
                {
                    "id": archive_run_id,
                    "source_id": payload.get("source_id"),
                    "status": payload.get("archive_run_status"),
                    "speed_bps": payload.get("speed_bps"),
                },
            )
    return payload


def fetch_media_sizes(tweet_ids: list[str]) -> dict[str, int]:
    if not tweet_ids:
        return {}
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select tweet_id, coalesce(sum(file_size), 0)::bigint as total_size
                from media_assets
                where tweet_id = any(%s)
                  and download_status in ('downloaded', 'verified')
                group by tweet_id
                """,
                (tweet_ids,),
            )
            return {str(row["tweet_id"]): int(row["total_size"] or 0) for row in cur.fetchall()}


def run_command_with_progress(
    command: list[str],
    settings: Settings,
    job_id: int,
    candidate_tweets: list[dict[str, str]],
    run_item_ids: dict[str, int] | None,
    engine: str,
    log_stream_id: int | None = None,
) -> subprocess.CompletedProcess[str]:
    """运行下载器命令，并在运行期间持续解析进度输出。"""

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    stdout_chunks = TextTailBuffer(DOWNLOAD_STDOUT_TAIL_CHARS)
    stderr_chunks = TextTailBuffer(DOWNLOAD_STDERR_TAIL_CHARS)
    progress_state = DownloadProgressState(last_fallback_scan_at=time.monotonic())
    state_lock = Lock()
    pending_log_entries: Queue[dict[str, object]] = Queue(maxsize=DOWNLOAD_LOG_QUEUE_SIZE)
    reader_errors: Queue[tuple[str, BaseException]] = Queue(maxsize=2)
    stop_readers = Event()
    tweet_ids = [tweet["tweet_id"] for tweet in candidate_tweets]
    tweet_id_set = set(tweet_ids)

    def read_stream(stream, chunks: TextTailBuffer, stream_name: str) -> None:
        """读取 stdout/stderr，并从中抽取下载进度信号。"""

        if stream is None:
            return
        try:
            for chunk in stream:
                if stop_readers.is_set():
                    break
                chunks.append(chunk)
                if log_stream_id is not None and not queue_download_log_entry(
                    pending_log_entries,
                    stop_readers,
                    level=download_output_log_level(engine, stream_name, chunk),
                    component=f"{engine}.{stream_name}",
                    message=chunk.rstrip("\r\n") or f"{stream_name} 输出空行",
                    raw=chunk,
                ):
                    break
                if engine == "yt-dlp":
                    progress = parse_downloader_progress(chunk)
                    if not progress:
                        continue
                    tweet_id = str(progress["tweet_id"])
                    if tweet_id not in tweet_id_set:
                        continue
                    with state_lock:
                        progress_state.native_progress_seen = True
                        progress_state.last_native_progress_at = time.monotonic()
                        progress_state.current_tweet_id = tweet_id
                    record_download_progress(
                        progress_state,
                        state_lock,
                        job_id,
                        candidate_tweets,
                        run_item_ids,
                        f"{engine} 下载中",
                        {
                            tweet_id: {
                                "downloaded_bytes": int(progress["downloaded_bytes"]),
                                "total_bytes": int(progress["total_bytes"]),
                                "speed_bps": int(progress["speed_bps"]),
                            }
                        },
                        current_tweet_id=tweet_id,
                    )
                    continue
                event = parse_gallery_dl_progress(chunk)
                if not event:
                    continue
                handle_gallery_dl_progress_event(
                    event,
                    settings.archive_dir,
                    tweet_id_set,
                    progress_state,
                    state_lock,
                    job_id,
                    candidate_tweets,
                    run_item_ids,
                )
        except Exception as exc:
            try:
                reader_errors.put_nowait((stream_name, exc))
            except Full:
                pass
            stop_readers.set()

    stdout_thread = Thread(target=read_stream, args=(process.stdout, stdout_chunks, "stdout"), daemon=True)
    stderr_thread = Thread(target=read_stream, args=(process.stderr, stderr_chunks, "stderr"), daemon=True)
    fallback_previous_by_tweet = {tweet_id: 0 for tweet_id in tweet_ids}
    fallback_sampled = False
    fallback_interval = max(
        0.0,
        float(getattr(settings, "downloader_progress_fallback_interval_seconds", 10.0)),
    )
    reader_drain_timed_out = False
    primary_error: BaseException | None = None
    try:
        stdout_thread.start()
        stderr_thread.start()
        while process.poll() is None:
            time.sleep(1)
            raise_download_reader_error(reader_errors)
            flush_download_log_entries(log_stream_id, pending_log_entries)
            raise_download_reader_error(reader_errors)
            current_at = time.monotonic()
            with state_lock:
                native_progress_seen = progress_state.native_progress_seen
                last_native_progress_at = progress_state.last_native_progress_at
                current_tweet_id = progress_state.current_tweet_id
                current_path = progress_state.current_path
                previous_bytes = progress_state.previous_bytes
                previous_sample_at = progress_state.previous_sample_at
                completed_bytes = progress_state.completed_bytes_by_tweet.get(current_tweet_id or "", 0)
                last_fallback_scan_at = progress_state.last_fallback_scan_at
            # 当原生进度暂时不可用时，回退到采样当前下载文件大小。
            if current_tweet_id and current_path:
                if (
                    last_native_progress_at is not None
                    and current_at - last_native_progress_at < 2.0
                ):
                    continue
                current_file_bytes = sample_current_download_path(current_path)
                if current_file_bytes is None:
                    continue
                elapsed = max(current_at - (previous_sample_at or current_at), 0.001)
                speed_bps = (
                    max(0, int((current_file_bytes - previous_bytes) / elapsed))
                    if previous_sample_at is not None
                    else 0
                )
                downloaded_bytes = completed_bytes + current_file_bytes
                with state_lock:
                    progress_state.previous_bytes = current_file_bytes
                    progress_state.previous_sample_at = current_at
                if downloaded_bytes or speed_bps:
                    record_download_progress(
                        progress_state,
                        state_lock,
                        job_id,
                        candidate_tweets,
                        run_item_ids,
                        f"{engine} 下载中（文件采样）",
                        {
                            current_tweet_id: {
                                "downloaded_bytes": downloaded_bytes,
                                "speed_bps": speed_bps,
                            }
                        },
                        current_tweet_id=current_tweet_id,
                    )
                continue
            # 如果下载器从未输出原生进度，再退回到周期性扫描 archive 目录估算。
            if native_progress_seen:
                continue
            if not should_run_fallback_scan(
                last_fallback_scan_at,
                current_at,
                fallback_interval,
            ):
                continue
            current_by_tweet = estimate_downloaded_bytes_by_tweet(settings.archive_dir, tweet_ids)
            elapsed = max(current_at - (last_fallback_scan_at or current_at), 0.001)
            progress_by_tweet = {
                tweet_id: {
                    "downloaded_bytes": current_by_tweet[tweet_id],
                    "speed_bps": max(
                        0,
                        int(
                            (current_by_tweet[tweet_id] - fallback_previous_by_tweet[tweet_id])
                            / elapsed
                        ),
                    ) if fallback_sampled else 0,
                }
                for tweet_id in tweet_ids
            }
            if any(progress["downloaded_bytes"] or progress["speed_bps"] for progress in progress_by_tweet.values()):
                current_tweet_id = next(
                    (tweet_id for tweet_id in tweet_ids if progress_by_tweet[tweet_id]["speed_bps"] > 0),
                    None,
                )
                record_download_progress(
                    progress_state,
                    state_lock,
                    job_id,
                    candidate_tweets,
                    run_item_ids,
                    f"{engine} 下载中（估算）",
                    progress_by_tweet,
                    current_tweet_id=current_tweet_id,
                )
            fallback_previous_by_tweet = current_by_tweet
            fallback_sampled = True
            with state_lock:
                progress_state.last_fallback_scan_at = current_at

        return_code = process.wait()
        drain_deadline = time.monotonic() + DOWNLOAD_READER_DRAIN_TIMEOUT_SECONDS
        while stdout_thread.is_alive() or stderr_thread.is_alive() or not pending_log_entries.empty():
            raise_download_reader_error(reader_errors)
            if not pending_log_entries.empty():
                flush_download_log_entries(log_stream_id, pending_log_entries)
            remaining = drain_deadline - time.monotonic()
            if remaining <= 0:
                reader_drain_timed_out = True
                raise RuntimeError("downloader_reader_drain_timeout")
            join_timeout = min(0.05, remaining)
            stdout_thread.join(timeout=join_timeout)
            stderr_thread.join(timeout=join_timeout)
        raise_download_reader_error(reader_errors)
        flush_pending_download_progress(progress_state, state_lock, job_id, candidate_tweets, run_item_ids)
        return subprocess.CompletedProcess(
            command,
            return_code,
            stdout_chunks.getvalue(),
            stderr_chunks.getvalue(),
        )
    except BaseException as exc:
        primary_error = exc
        raise
    finally:
        stop_readers.set()
        stop_process_group(
            process,
            timeout_seconds=DOWNLOAD_PROCESS_STOP_TIMEOUT_SECONDS,
            include_process_group=reader_drain_timed_out or process.poll() is None,
        )
        for stream in (process.stdout, process.stderr):
            close = getattr(stream, "close", None)
            if not callable(close):
                continue
            try:
                close()
            except (OSError, ValueError):
                logger.warning("Failed to close downloader output pipe", exc_info=True)
        for thread in (stdout_thread, stderr_thread):
            if thread.ident is not None:
                thread.join(timeout=DOWNLOAD_READER_JOIN_TIMEOUT_SECONDS)
                if thread.is_alive():
                    logger.error("Downloader reader thread did not stop: %s", thread.name)
        try:
            while not pending_log_entries.empty():
                flush_download_log_entries(log_stream_id, pending_log_entries)
        except Exception as exc:
            if primary_error is None:
                raise
            primary_error.add_note(f"pending downloader log flush failed: {exc!r}")
            logger.error(
                "Failed to flush pending downloader logs while handling an earlier error",
                exc_info=True,
            )


def parse_downloader_progress(line: str) -> dict[str, int | str] | None:
    """解析 yt-dlp 注入的结构化进度行。"""

    match = YTDLP_PROGRESS_RE.search(line)
    if not match:
        return None
    downloaded = parse_progress_number(match.group("downloaded"))
    total = parse_progress_number(match.group("total")) or parse_progress_number(match.group("estimate"))
    speed = parse_progress_number(match.group("speed"))
    if downloaded is None and total is None and speed is None:
        return None
    return {
        "tweet_id": match.group("tweet_id").strip(),
        "downloaded_bytes": downloaded or 0,
        "total_bytes": total or 0,
        "speed_bps": speed or 0,
    }


def parse_gallery_dl_progress(line: str) -> dict[str, int | str] | None:
    """解析 gallery-dl 的结构化进度行或文件事件。"""

    file_match = GALLERY_DL_FILE_RE.search(line.strip())
    if file_match:
        return {
            "event": file_match.group("event"),
            "filename": file_match.group("filename").strip(),
        }
    progress_match = GALLERY_DL_PROGRESS_RE.search(line.strip())
    if not progress_match:
        return None
    return {
        "event": "progress",
        "downloaded_bytes": parse_gallery_dl_size(progress_match.group("downloaded")) or 0,
        "speed_bps": parse_gallery_dl_size(progress_match.group("speed")) or 0,
        "total_bytes": parse_gallery_dl_size(progress_match.group("total")) or 0,
        "percent": parse_progress_number(progress_match.group("percent")) or 0,
    }


def parse_gallery_dl_size(value: str | None) -> int | None:
    """把 gallery-dl 的体积文本解析成字节数。"""

    if value is None:
        return None
    match = GALLERY_DL_SIZE_RE.fullmatch(value.strip())
    if not match:
        return None
    number = float(match.group("value"))
    unit = match.group("unit").upper()
    if not unit:
        return max(0, int(number))
    exponent = "KMGTPEZY".index(unit) + 1
    base = 1024 if match.group("binary") else 1000
    return max(0, int(number * (base**exponent)))


def handle_gallery_dl_progress_event(
    event: dict[str, int | str],
    archive_dir: Path,
    tweet_ids: set[str],
    state: DownloadProgressState,
    state_lock: Lock,
    job_id: int,
    candidate_tweets: list[dict[str, str]],
    run_item_ids: dict[str, int] | None,
) -> None:
    """处理 gallery-dl 文件事件与进度事件。"""

    event_type = str(event["event"])
    if event_type in {"start", "success", "skip"}:
        resolved = resolve_gallery_dl_progress_path(
            str(event.get("filename") or ""),
            archive_dir,
            tweet_ids,
        )
        if resolved is None:
            return
        tweet_id, path = resolved
        if event_type == "start":
            with state_lock:
                previous_tweet_id = state.current_tweet_id
            if previous_tweet_id and previous_tweet_id != tweet_id:
                flush_pending_download_progress(state, state_lock, job_id, candidate_tweets, run_item_ids)
            with state_lock:
                state.current_tweet_id = tweet_id
                state.current_path = path
                state.previous_bytes = 0
                state.previous_sample_at = None
            return
        if event_type == "success":
            final_bytes = sample_current_download_path(path) or 0
            with state_lock:
                if path not in state.completed_paths:
                    state.completed_paths.add(path)
                    state.completed_bytes_by_tweet[tweet_id] = (
                        state.completed_bytes_by_tweet.get(tweet_id, 0) + final_bytes
                    )
                downloaded_bytes = state.completed_bytes_by_tweet[tweet_id]
                state.current_tweet_id = None
                state.current_path = None
                state.previous_bytes = 0
                state.previous_sample_at = None
            record_download_progress(
                state,
                state_lock,
                job_id,
                candidate_tweets,
                run_item_ids,
                "gallery-dl 文件下载完成",
                {
                    tweet_id: {
                        "downloaded_bytes": downloaded_bytes,
                        "speed_bps": 0,
                    }
                },
                current_tweet_id=tweet_id,
                force=True,
            )
            return
        with state_lock:
            state.current_tweet_id = None
            state.current_path = None
            state.previous_bytes = 0
            state.previous_sample_at = None
        return
    if event_type != "progress":
        return
    with state_lock:
        tweet_id = state.current_tweet_id
        if tweet_id is None:
            return
        state.native_progress_seen = True
        state.last_native_progress_at = time.monotonic()
        state.previous_bytes = int(event.get("downloaded_bytes") or 0)
        state.previous_sample_at = state.last_native_progress_at
        downloaded_bytes = (
            state.completed_bytes_by_tweet.get(tweet_id, 0)
            + int(event.get("downloaded_bytes") or 0)
        )
    record_download_progress(
        state,
        state_lock,
        job_id,
        candidate_tweets,
        run_item_ids,
        "gallery-dl 下载中",
        {
            tweet_id: {
                "downloaded_bytes": downloaded_bytes,
                "speed_bps": int(event.get("speed_bps") or 0),
            }
        },
        current_tweet_id=tweet_id,
    )


def resolve_gallery_dl_progress_path(
    filename: str,
    archive_dir: Path,
    tweet_ids: set[str],
) -> tuple[str, Path] | None:
    """把 gallery-dl 输出的文件名解析成 tweet_id 和真实路径。"""

    if not filename:
        return None
    media_dir = (archive_dir / "media").resolve()
    path = Path(filename)
    if not path.is_absolute():
        path = media_dir / path
    try:
        resolved_path = path.resolve()
        resolved_path.relative_to(media_dir)
    except (OSError, ValueError):
        return None
    tweet_id = next((part for part in resolved_path.parts if part in tweet_ids), None)
    if tweet_id is None:
        return None
    return tweet_id, resolved_path


def sample_current_download_path(path: Path) -> int | None:
    """采样当前下载中的 `.part` 文件或已落盘文件大小。"""

    part_path = Path(f"{path}.part")
    if part_path.is_file():
        return safe_file_size(part_path)
    if path.is_file():
        return safe_file_size(path)
    return None


def should_run_fallback_scan(
    last_scan_at: float | None,
    current_at: float,
    interval_seconds: float,
) -> bool:
    """判断当前是否应该执行回退式目录扫描。"""

    if interval_seconds <= 0:
        return False
    return last_scan_at is None or current_at - last_scan_at >= interval_seconds


def parse_progress_number(value: str | None) -> int | None:
    """把进度文本解析成非负整数。"""

    if value is None:
        return None
    text = value.strip()
    if not text or text in {"NA", "N/A", "None", "none"}:
        return None
    try:
        return max(0, int(float(text)))
    except ValueError:
        return None


def estimate_downloaded_bytes(archive_dir: Path, tweet_ids: list[str]) -> int:
    """估算一组 tweet 当前已下载的总字节数。"""

    return sum(estimate_downloaded_bytes_by_tweet(archive_dir, tweet_ids).values())


def estimate_downloaded_bytes_by_tweet(archive_dir: Path, tweet_ids: list[str]) -> dict[str, int]:
    """扫描 archive 目录，按 tweet 估算已下载字节数。"""

    sizes = {tweet_id: 0 for tweet_id in tweet_ids}
    if not tweet_ids:
        return sizes
    media_dir = archive_dir / "media"
    if not media_dir.exists():
        return sizes
    tweet_tokens = set(tweet_ids)
    for path in media_dir.rglob("*"):
        if not path.is_file():
            continue
        tweet_id = next((part for part in path.parts if part in tweet_tokens), None)
        if tweet_id is None:
            continue
        if path.suffix.lower() in {".json", ".part", ".ytdl"}:
            if path.suffix.lower() == ".part":
                sizes[tweet_id] += safe_file_size(path)
            continue
        sizes[tweet_id] += safe_file_size(path)
    return sizes


def safe_file_size(path: Path) -> int:
    """安全读取文件大小；失败时返回 0。"""

    try:
        return path.stat().st_size
    except OSError:
        return 0


def set_tweets_downloading(tweet_ids: list[str]) -> None:
    """把一批 tweet 标记为 downloading。"""

    if not tweet_ids:
        return
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update tweets
                set download_status = 'downloading',
                    last_attempt_at = now(),
                    updated_at = now()
                where tweet_id = any(%s)
                """,
                (tweet_ids,),
            )
        conn.commit()


def mark_tweets_downloaded(tweet_ids: list[str]) -> None:
    """把一批 tweet 标记为 downloaded。"""

    if not tweet_ids:
        return
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update tweets
                set download_status = 'downloaded',
                    last_error = null,
                    updated_at = now()
                where tweet_id = any(%s)
                """,
                (tweet_ids,),
            )
        conn.commit()


def mark_tweets_failed(tweet_ids: list[str], status: str, error: str) -> None:
    """把一批 tweet 标记为失败状态并递增重试次数。"""

    if not tweet_ids:
        return
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update tweets
                set download_status = %s,
                    last_error = %s,
                    retry_count = retry_count + 1,
                    updated_at = now()
                where tweet_id = any(%s)
                """,
                (status, error, tweet_ids),
            )
        conn.commit()


def mark_attempts(
    job_id: int,
    tweets: list[dict[str, str]],
    engine: str,
    status: str,
    exit_code: int,
    error_category: str | None,
    stderr_excerpt: str | None,
    run_item_ids: dict[str, int] | None = None,
) -> None:
    """为每个 tweet 写入一条 download_attempts 记录。"""

    if not tweets:
        return
    with connect() as conn:
        with conn.cursor() as cur:
            for tweet in tweets:
                cur.execute(
                    """
                    insert into download_attempts (
                        job_id,
                        tweet_id,
                        engine,
                        status,
                        exit_code,
                        error_category,
                        error_message,
                        stderr_excerpt,
                        archive_run_item_id,
                        finished_at
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                    """,
                    (
                        job_id,
                        tweet["tweet_id"],
                        engine,
                        status,
                        exit_code,
                        error_category,
                        error_category,
                        stderr_excerpt,
                        (run_item_ids or {}).get(tweet["tweet_id"]),
                    ),
                )
        conn.commit()


def classify_error(exit_code: int, stderr: str | None) -> str:
    """根据 stderr 内容把下载失败归类到统一错误类别。"""

    return category_value(classify_x_error(stderr)) or ErrorCategory.UNKNOWN.value


def extract_tweet_stderr(stderr: str, tweet_ids: set[str]) -> dict[str, str]:
    """从批次 stderr 中提取可明确归属到单条 Tweet 的日志片段。"""

    segments: dict[str, list[str]] = {}
    current_tweet_id: str | None = None
    for line in stderr.splitlines():
        direct_match = YTDLP_TWEET_ERROR_RE.search(line)
        url_match = TWEET_STATUS_URL_RE.search(line)
        matched_tweet_id = (
            direct_match.group("tweet_id")
            if direct_match is not None
            else url_match.group("tweet_id") if url_match is not None else None
        )
        if matched_tweet_id is not None:
            # 即使 marker 属于已成功、因而不在待分类集合中的 Tweet，也必须
            # 截断前一个片段，避免后续全局日志被错误归给上一条失败项。
            current_tweet_id = matched_tweet_id if matched_tweet_id in tweet_ids else None
        if current_tweet_id is not None:
            segments.setdefault(current_tweet_id, []).append(line)
    return {
        tweet_id: "\n".join(lines)[-4000:]
        for tweet_id, lines in segments.items()
    }


def classify_missing_tweets(
    tweets: list[DownloadCandidateRow],
    exit_code: int,
    stderr: str,
) -> dict[str, dict[str, str | None]]:
    """逐 Tweet 分类未产出媒体项，避免把同批其他 Tweet 的错误串写进来。"""

    tweet_ids = {str(tweet["tweet_id"]) for tweet in tweets}
    stderr_by_tweet = extract_tweet_stderr(stderr, tweet_ids)
    has_tweet_marker = bool(YTDLP_TWEET_ERROR_RE.search(stderr) or TWEET_STATUS_URL_RE.search(stderr))
    global_stderr = stderr[-4000:] if exit_code != 0 and stderr and not has_tweet_marker else None
    details: dict[str, dict[str, str | None]] = {}
    permanent_categories = {item.value for item in PERMANENT_DOWNLOAD_CATEGORIES}
    for tweet in tweets:
        tweet_id = str(tweet["tweet_id"])
        tweet_stderr = stderr_by_tweet.get(tweet_id) or global_stderr
        category = (
            classify_error(exit_code, tweet_stderr)
            if exit_code != 0 and tweet_stderr
            else ErrorCategory.DOWNLOAD_NO_OUTPUT.value
        )
        details[tweet_id] = {
            "category": category,
            "status": "failed_permanent" if category in permanent_categories else "failed_retryable",
            "stderr_excerpt": redact_sensitive_text(tweet_stderr) or None,
        }
    return details


def summarize_failure_category(details: dict[str, dict[str, str | None]]) -> str | None:
    """为 Job 摘要选择出现次数最多的逐 Tweet 错误类别。"""

    categories = [str(detail["category"]) for detail in details.values() if detail.get("category")]
    if not categories:
        return None
    counts = Counter(categories)
    return min(counts, key=lambda category: (-counts[category], category))


def backfilled_tweet_ids_for_engine(backfill_result: dict[str, object], engine: str) -> set[str]:
    """读取本次引擎真正产出的 Tweet；兼容旧测试或调用方结果结构。"""

    by_engine = backfill_result.get("tweet_ids_by_engine")
    if isinstance(by_engine, dict):
        values = by_engine.get(engine, [])
        if isinstance(values, list):
            return {str(value) for value in values}
        return set()
    return {str(value) for value in backfill_result.get("tweet_ids", [])}


def engine_backfill_result(backfill_result: dict[str, object], engine: str) -> dict[str, object]:
    """把跨引擎回填摘要收窄为当前引擎，供引擎附属流程使用。"""

    result = dict(backfill_result)
    result["tweet_ids"] = sorted(backfilled_tweet_ids_for_engine(backfill_result, engine))
    by_engine = backfill_result.get("media_ids_by_engine")
    result["media_ids"] = list(by_engine.get(engine, [])) if isinstance(by_engine, dict) else list(
        backfill_result.get("media_ids", [])
    )
    return result


def download_log_relative_path(job_id: int) -> str:
    """构造下载 Job 对应的 archive 相对 JSONL 路径。"""

    return f"logs/download-logs/job-{job_id}.jsonl"


def get_download_job_log_stream_id(job_id: int) -> int | None:
    """读取下载 Job 的日志流关联；旧 Job 允许没有日志流。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select log_stream_id from download_jobs where id = %s", (job_id,))
            row = cur.fetchone()
    return int(row["log_stream_id"]) if row and row["log_stream_id"] is not None else None


def append_download_log(
    log_stream_id: int | None,
    level: str,
    component: str,
    message: str,
    *,
    raw: str | None = None,
    context: dict[str, object] | None = None,
    exception: BaseException | None = None,
) -> None:
    """向下载日志流追加一条可审计记录；兼容旧 Job 无日志流。"""

    if log_stream_id is not None:
        append_operation_log_entry(log_stream_id, level, component, message, raw=raw, context=context, exception=exception)


def queue_download_log_entry(
    pending_entries: Queue[dict[str, object]],
    stop_event: Event,
    *,
    level: str,
    component: str,
    message: str,
    raw: str,
) -> bool:
    """Boundedly queue downloader output for the main thread to persist."""

    entry = {"level": level, "component": component, "message": message, "raw": raw}
    while not stop_event.is_set():
        try:
            pending_entries.put(entry, timeout=DOWNLOAD_LOG_QUEUE_PUT_TIMEOUT_SECONDS)
            return True
        except Full:
            continue
    return False


def flush_download_log_entries(
    log_stream_id: int | None,
    pending_entries: Queue[dict[str, object]],
) -> int:
    """批量持久化已读取的下载器输出，并合并为一次日志事件。"""

    if log_stream_id is None:
        return 0
    entries: list[dict[str, object]] = []
    for _ in range(DOWNLOAD_LOG_BATCH_SIZE):
        try:
            entries.append(pending_entries.get_nowait())
        except Empty:
            break
    if not entries:
        return 0
    return len(append_operation_log_entries(log_stream_id, entries))


def raise_download_reader_error(
    reader_errors: Queue[tuple[str, BaseException]],
) -> None:
    try:
        stream_name, error = reader_errors.get_nowait()
    except Empty:
        return
    raise RuntimeError(f"downloader_{stream_name}_reader_failed") from error


def download_output_log_level(engine: str, stream_name: str, line: str) -> str:
    """按下载器输出和流来源推断适合筛选的日志级别。"""

    if engine == "gallery-dl":
        return parse_gallery_dl_log_level(line)
    if re.match(r"^\s*ERROR:", line, re.IGNORECASE):
        return "error"
    if re.match(r"^\s*WARNING:", line, re.IGNORECASE):
        return "warning"
    return "info"


def empty_backfill_result() -> dict[str, object]:
    """返回空的媒体回填结果结构。"""

    return {
        "scanned": 0,
        "upserted": 0,
        "skipped": 0,
        "media_ids": [],
        "tweet_ids": [],
        "media_ids_by_engine": {},
        "tweet_ids_by_engine": {},
    }


def log_download_event(event: str, **details: object) -> None:
    """输出结构化下载日志事件。"""

    logger.info("Download event: %s", event, extra={"event": event, "details": details})
