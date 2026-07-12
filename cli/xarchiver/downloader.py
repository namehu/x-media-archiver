from __future__ import annotations

import logging
import re
import shutil
import subprocess
import time
from pathlib import Path
from threading import Thread

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
        "--progress-template",
        f"download:{YTDLP_PROGRESS_PREFIX}%(info.id)s|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s",
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

    progress_seen = False

    def read_stream(stream, chunks: list[str]) -> None:
        nonlocal progress_seen
        if stream is None:
            return
        for chunk in stream:
            chunks.append(chunk)
            progress = parse_downloader_progress(chunk)
            if progress:
                progress_seen = True
                tweet_id = str(progress["tweet_id"])
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

    stdout_thread = Thread(target=read_stream, args=(process.stdout, stdout_chunks), daemon=True)
    stderr_thread = Thread(target=read_stream, args=(process.stderr, stderr_chunks), daemon=True)
    stdout_thread.start()
    stderr_thread.start()

    tweet_ids = [tweet["tweet_id"] for tweet in candidate_tweets]
    previous_by_tweet = estimate_downloaded_bytes_by_tweet(settings.archive_dir, tweet_ids)
    previous_at = time.monotonic()
    while process.poll() is None:
        time.sleep(1)
        if engine == "yt-dlp" and progress_seen:
            continue
        current_by_tweet = estimate_downloaded_bytes_by_tweet(settings.archive_dir, tweet_ids)
        current_at = time.monotonic()
        elapsed = max(current_at - previous_at, 0.001)
        progress_by_tweet = {
            tweet_id: {
                "downloaded_bytes": current_by_tweet[tweet_id],
                "speed_bps": max(0, int((current_by_tweet[tweet_id] - previous_by_tweet[tweet_id]) / elapsed)),
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
        previous_by_tweet = current_by_tweet
        previous_at = current_at

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
