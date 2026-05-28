from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path

from xarchiver.archive import ensure_archive_dirs, normalize_path
from xarchiver.config import Settings
from xarchiver.core.errors import (
    ErrorCategory,
    PERMANENT_DOWNLOAD_CATEGORIES,
    category_value,
    classify_x_error,
)
from xarchiver.db import connect
from xarchiver.media import backfill_media_assets


SUPPORTED_ENGINES = {"gallery-dl", "yt-dlp"}
logger = logging.getLogger(__name__)


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

    cookie_error = validate_cookie_file(engine, settings.cookie_file)
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

    command = build_command(engine, settings, input_path)
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
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    stderr_excerpt = result.stderr[-4000:] if result.stderr else None

    if result.returncode == 0:
        backfill_result = backfill_media_assets(
            settings.archive_dir,
            tweet_ids=[tweet["tweet_id"] for tweet in tweets],
        )
        downloaded_ids = set(backfill_result["tweet_ids"])
        downloaded = [tweet for tweet in tweets if tweet["tweet_id"] in downloaded_ids]
        missing = [tweet for tweet in tweets if tweet["tweet_id"] not in downloaded_ids]

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
) -> list[dict[str, str]]:
    sql = """
        select tweet_id, url
        from tweets
        where download_status in ('pending', 'failed_retryable', 'missing', 'corrupt')
    """
    params: list[object] = []
    if retry_limit is not None:
        sql += " and retry_count < %s"
        params.append(retry_limit)
    if retry_backoff_minutes > 0:
        sql += """
          and (
              download_status = 'pending'
              or last_attempt_at is null
              or last_attempt_at <= now() - make_interval(mins => %s * greatest(retry_count, 1))
          )
        """
        params.append(retry_backoff_minutes)
    if tweet_ids is not None:
        sql += " and tweet_id = any(%s)"
        params.append(tweet_ids)
    sql += " order by imported_at asc"
    if limit:
        sql += " limit %s"
        params.append(limit)

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, tuple(params))
            return list(cur.fetchall())


def write_input_file(archive_dir: Path, engine: str, urls: list[str]) -> Path:
    path = archive_dir / "raw" / "downloader_inputs" / f"{engine}-input.txt"
    path.write_text("\n".join(urls) + ("\n" if urls else ""), encoding="utf-8")
    return path


def build_command(engine: str, settings: Settings, input_path: Path) -> list[str]:
    sleep_min = format_sleep_seconds(getattr(settings, "downloader_sleep_min_seconds", 2.0))
    sleep_max = format_sleep_seconds(getattr(settings, "downloader_sleep_max_seconds", 6.0))
    sleep_range = format_sleep_range(
        getattr(settings, "downloader_sleep_min_seconds", 2.0),
        getattr(settings, "downloader_sleep_max_seconds", 6.0),
    )
    if engine == "gallery-dl":
        return [
            "gallery-dl",
            "--config",
            "/app/gallery-dl.conf",
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

    runtime_cookie_file = settings.archive_dir / "state" / "yt-dlp-cookies.txt"
    shutil.copyfile(settings.cookie_file, runtime_cookie_file)

    return [
        "yt-dlp",
        "--cookies",
        str(runtime_cookie_file),
        "--sleep-requests",
        sleep_min,
        "--sleep-interval",
        sleep_min,
        "--max-sleep-interval",
        sleep_max,
        "--write-info-json",
        "--write-thumbnail",
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


def validate_cookie_file(engine: str, cookie_file: Path) -> str | None:
    if engine != "yt-dlp":
        return None
    if not cookie_file.exists():
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
                    job_type, engine, input_path, status, total_count, started_at, archive_run_id
                )
                values ('download', %s, %s, %s, %s, now(), %s)
                returning id
                """,
                (engine, normalize_path(input_path), status, total_count, archive_run_id),
            )
            job_id = int(cur.fetchone()["id"])
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
                    finished_at = now()
                where id = %s
                """,
                (status, success_count, failed_count, error, job_id),
            )
        conn.commit()


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
