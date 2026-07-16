from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock, Thread

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
from xarchiver.db import connect
from xarchiver.media import backfill_media_assets
from xarchiver.row_models import DownloadCandidateRow, IdRow
from xarchiver.services.cookies import resolve_cookie_content
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
GALLERY_DL_OUTPUT_MODE = {
    "start": f"{GALLERY_DL_PROGRESS_PREFIX}start|{{}}\n",
    "success": f"{GALLERY_DL_PROGRESS_PREFIX}success|{{}}\n",
    "skip": f"{GALLERY_DL_PROGRESS_PREFIX}skip|{{}}\n",
    "progress": f"{GALLERY_DL_PROGRESS_PREFIX}progress|{{0}}|{{1}}|0|0\n",
    "progress-total": f"{GALLERY_DL_PROGRESS_PREFIX}progress|{{0}}|{{1}}|{{2}}|{{3}}\n",
}


@dataclass
class DownloadProgressState:
    native_progress_seen: bool = False
    last_native_progress_at: float | None = None
    current_tweet_id: str | None = None
    current_path: Path | None = None
    previous_bytes: int = 0
    previous_sample_at: float | None = None
    last_fallback_scan_at: float | None = None
    completed_bytes_by_tweet: dict[str, int] = field(default_factory=dict)
    completed_paths: set[Path] = field(default_factory=set)


def download(
    engine: str,
    settings: Settings,
    limit: int | None,
    dry_run: bool,
    tweet_ids: list[str] | None = None,
    archive_run_id: int | None = None,
    run_item_ids: dict[str, int] | None = None,
) -> dict[str, object]:
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

    command = build_command(engine, settings, input_path, cookie_path)
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
    mark_run_items_progress(job_id, tweets, run_item_ids, f"{engine} 下载中")
    result = run_command_with_progress(command, settings, job_id, tweets, run_item_ids, engine)
    stderr_excerpt = result.stderr[-4000:] if result.stderr else None

    if result.returncode == 0:
        mark_run_items_progress(job_id, tweets, run_item_ids, "下载器完成，正在回填媒体")
        backfill_result = backfill_media_assets(
            settings.archive_dir,
            tweet_ids=[tweet["tweet_id"] for tweet in tweets],
        )
        media_sizes = fetch_media_sizes([tweet["tweet_id"] for tweet in tweets])
        downloaded_ids = set(backfill_result["tweet_ids"])
        downloaded = [tweet for tweet in tweets if tweet["tweet_id"] in downloaded_ids]
        missing = [tweet for tweet in tweets if tweet["tweet_id"] not in downloaded_ids]
        mark_run_items_finished(downloaded, run_item_ids, media_sizes, "下载完成，等待校验")
        mark_run_items_progress(
            job_id,
            missing,
            run_item_ids,
            "下载器未产出文件",
            downloaded_bytes=0,
            total_bytes=0,
            speed_bps=0,
        )

        mark_attempts(
            job_id,
            downloaded,
            engine,
            "downloaded",
            0,
            None,
            stderr_excerpt,
            run_item_ids,
        )
        mark_attempts(
            job_id,
            missing,
            engine,
            "failed_retryable",
            0,
            ErrorCategory.DOWNLOAD_NO_OUTPUT.value,
            stderr_excerpt,
            run_item_ids,
        )
        mark_tweets_downloaded([tweet["tweet_id"] for tweet in downloaded])
        mark_tweets_failed(
            [tweet["tweet_id"] for tweet in missing],
            "failed_retryable",
            ErrorCategory.DOWNLOAD_NO_OUTPUT.value,
        )
        status = "finished" if not missing else "partial"
        finish_job(
            job_id,
            status,
            len(downloaded),
            len(missing),
            None if not missing else ErrorCategory.DOWNLOAD_NO_OUTPUT.value,
        )
        log_download_event(
            "download.job.completed",
            job_id=job_id,
            engine=engine,
            status=status,
            exit_code=result.returncode,
            success_count=len(downloaded),
            failed_count=len(missing),
            error_category=None if not missing else ErrorCategory.DOWNLOAD_NO_OUTPUT.value,
        )
    else:
        category = classify_error(result.returncode, stderr_excerpt)
        status = (
            "failed_permanent"
            if category in {item.value for item in PERMANENT_DOWNLOAD_CATEGORIES}
            else "failed_retryable"
        )
        mark_attempts(
            job_id,
            tweets,
            engine,
            status,
            result.returncode,
            category,
            stderr_excerpt,
            run_item_ids,
        )
        mark_tweets_failed([tweet["tweet_id"] for tweet in tweets], status, category)
        mark_run_items_progress(
            job_id,
            tweets,
            run_item_ids,
            f"下载失败: {category}",
            downloaded_bytes=0,
            speed_bps=0,
        )
        finish_job(job_id, "failed", 0, len(tweets), category)
        log_download_event(
            "download.job.failed",
            job_id=job_id,
            engine=engine,
            status="failed",
            exit_code=result.returncode,
            error_category=category,
            failed_count=len(tweets),
        )

    return {
        "job_id": job_id,
        "input_path": input_path,
        "count": len(tweets),
        "exit_code": result.returncode,
        "media_backfill": backfill_result if result.returncode == 0 else None,
    }


def fetch_download_candidates(
    limit: int | None,
    retry_limit: int | None = None,
    retry_backoff_minutes: int = 0,
    tweet_ids: list[str] | None = None,
) -> list[DownloadCandidateRow]:
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
    path = archive_dir / "raw" / "downloader_inputs" / f"{engine}-input.txt"
    path.write_text("\n".join(urls) + ("\n" if urls else ""), encoding="utf-8")
    return path


def prepare_cookies(settings: Settings) -> Path | None:
    cookie = resolve_cookie_content(settings)
    if cookie is None:
        return None

    runtime_cookie_file = settings.archive_dir / "state" / "runtime-cookies.txt"
    runtime_cookie_file.parent.mkdir(parents=True, exist_ok=True)
    content = cookie.content if cookie.content.endswith("\n") else f"{cookie.content}\n"
    runtime_cookie_file.write_text(content, encoding="utf-8")
    return runtime_cookie_file


def build_command(engine: str, settings: Settings, input_path: Path, cookie_path: Path | None) -> list[str]:
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
            "--download-archive",
            str(settings.archive_dir / "state" / "gallery-dl-downloaded.txt"),
            "-i",
            str(input_path),
        ]
        return command

    return [
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
        "--download-archive",
        str(settings.archive_dir / "state" / "yt-dlp-downloaded.txt"),
        "-a",
        str(input_path),
        "-o",
        str(settings.archive_dir / "media" / "%(uploader_id)s" / "%(display_id)s" / "%(display_id)s.%(ext)s"),
    ]


def format_sleep_range(min_seconds: float, max_seconds: float) -> str:
    minimum = max(0.0, float(min_seconds))
    maximum = max(minimum, float(max_seconds))
    return f"{minimum:g}-{maximum:g}" if maximum > minimum else f"{minimum:g}"


def format_sleep_seconds(seconds: float) -> str:
    return f"{max(0.0, float(seconds)):g}"


def validate_cookie_file(engine: str, cookie_file: Path | None) -> str | None:
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
        return job_id


def finish_job(job_id: int, status: str, success_count: int, failed_count: int, error: str | None) -> None:
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


def mark_run_items_progress(
    job_id: int,
    candidate_tweets: list[dict[str, str]],
    run_item_ids: dict[str, int] | None,
    message: str,
    downloaded_bytes: int | None = None,
    total_bytes: int | None = None,
    speed_bps: int | None = None,
) -> None:
    if not candidate_tweets:
        return
    tweet_ids = [tweet["tweet_id"] for tweet in candidate_tweets]
    current_tweet_id = tweet_ids[0] if tweet_ids else None
    item_ids = [run_item_ids[tweet_id] for tweet_id in tweet_ids if run_item_ids and tweet_id in run_item_ids]
    progress_item_id = item_ids[0] if item_ids else None
    with connect() as conn:
        with conn.cursor() as cur:
            if item_ids:
                cur.execute(
                    """
                    update archive_run_items
                    set downloaded_bytes = case
                          when %s::bigint is null then downloaded_bytes
                          when id = %s then %s
                          else 0
                        end,
                        total_bytes = case
                          when %s::bigint is null then total_bytes
                          when id = %s then %s
                          else 0
                        end,
                        speed_bps = case
                          when %s::bigint is null then speed_bps
                          when id = %s then %s
                          else 0
                        end,
                        progress_message = %s,
                        last_progress_at = now(),
                        updated_at = now()
                    where id = any(%s)
                    """,
                    (
                        downloaded_bytes,
                        progress_item_id,
                        downloaded_bytes,
                        total_bytes,
                        progress_item_id,
                        total_bytes,
                        speed_bps,
                        progress_item_id,
                        speed_bps,
                        message,
                        item_ids,
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
        conn.commit()
    publish_event(
        "archive_runs",
        "archive.run.progress",
        {
            "job_id": job_id,
            "tweet_ids": tweet_ids,
            "progress_message": message,
            "downloaded_bytes": downloaded_bytes,
            "total_bytes": total_bytes,
            "speed_bps": speed_bps,
        },
    )


def mark_run_items_finished(
    candidate_tweets: list[dict[str, str]],
    run_item_ids: dict[str, int] | None,
    media_sizes: dict[str, int],
    message: str,
) -> None:
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
    """Persist one progress sample per tweet and publish one event for the whole batch."""
    if not candidate_tweets or not progress_by_tweet:
        return
    tweet_ids = [tweet["tweet_id"] for tweet in candidate_tweets]
    item_ids = [run_item_ids[tweet_id] for tweet_id in tweet_ids if run_item_ids and tweet_id in run_item_ids]
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
    with connect() as conn:
        with conn.cursor() as cur:
            if item_ids:
                cur.execute(
                    """
                    update archive_run_items
                    set speed_bps = 0,
                        progress_message = %s,
                        last_progress_at = now(),
                        updated_at = now()
                    where id = any(%s)
                    """,
                    (message, item_ids),
                )
            if rows:
                cur.executemany(
                    """
                    update archive_run_items
                    set downloaded_bytes = coalesce(%s, downloaded_bytes),
                        total_bytes = coalesce(%s, total_bytes),
                        speed_bps = coalesce(%s, 0),
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
        conn.commit()
    publish_event(
        "archive_runs",
        "archive.run.progress",
        {
            "job_id": job_id,
            "tweet_ids": list(progress_by_tweet),
            "current_tweet_id": current_tweet_id,
            "progress_message": message,
            "downloaded_bytes": downloaded_bytes,
            "total_bytes": total_bytes,
            "speed_bps": speed_bps,
        },
    )


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
) -> subprocess.CompletedProcess[str]:
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    stdout_chunks: list[str] = []
    stderr_chunks: list[str] = []
    progress_state = DownloadProgressState(last_fallback_scan_at=time.monotonic())
    state_lock = Lock()
    tweet_ids = [tweet["tweet_id"] for tweet in candidate_tweets]
    tweet_id_set = set(tweet_ids)

    def read_stream(stream, chunks: list[str]) -> None:
        if stream is None:
            return
        for chunk in stream:
            chunks.append(chunk)
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
                mark_run_items_tweet_progress(
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

    stdout_thread = Thread(target=read_stream, args=(process.stdout, stdout_chunks), daemon=True)
    stderr_thread = Thread(target=read_stream, args=(process.stderr, stderr_chunks), daemon=True)
    stdout_thread.start()
    stderr_thread.start()

    fallback_previous_by_tweet = {tweet_id: 0 for tweet_id in tweet_ids}
    fallback_sampled = False
    fallback_interval = max(
        0.0,
        float(getattr(settings, "downloader_progress_fallback_interval_seconds", 10.0)),
    )
    while process.poll() is None:
        time.sleep(1)
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
                mark_run_items_tweet_progress(
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
            mark_run_items_tweet_progress(
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
    stdout_thread.join(timeout=1)
    stderr_thread.join(timeout=1)
    return subprocess.CompletedProcess(command, return_code, "".join(stdout_chunks), "".join(stderr_chunks))


def parse_downloader_progress(line: str) -> dict[str, int | str] | None:
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
            mark_run_items_tweet_progress(
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
    mark_run_items_tweet_progress(
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
    if interval_seconds <= 0:
        return False
    return last_scan_at is None or current_at - last_scan_at >= interval_seconds


def parse_progress_number(value: str | None) -> int | None:
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
    return sum(estimate_downloaded_bytes_by_tweet(archive_dir, tweet_ids).values())


def estimate_downloaded_bytes_by_tweet(archive_dir: Path, tweet_ids: list[str]) -> dict[str, int]:
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
    try:
        return path.stat().st_size
    except OSError:
        return 0


def set_tweets_downloading(tweet_ids: list[str]) -> None:
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
    return category_value(classify_x_error(stderr)) or ErrorCategory.UNKNOWN.value


def empty_backfill_result() -> dict[str, object]:
    return {"scanned": 0, "upserted": 0, "skipped": 0, "media_ids": [], "tweet_ids": []}


def log_download_event(event: str, **details: object) -> None:
    logger.info("Download event: %s", event, extra={"event": event, "details": details})
