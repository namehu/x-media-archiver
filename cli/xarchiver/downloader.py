from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import orjson

from xarchiver.archive import ensure_archive_dirs, normalize_path
from xarchiver.config import Settings
from xarchiver.db import connect


SUPPORTED_ENGINES = {"gallery-dl", "yt-dlp"}


def download(engine: str, settings: Settings, limit: int | None, dry_run: bool) -> dict[str, object]:
    if engine not in SUPPORTED_ENGINES:
        raise ValueError(f"Unsupported engine: {engine}")

    ensure_archive_dirs(settings.archive_dir)
    tweets = fetch_download_candidates(limit)
    input_path = write_input_file(settings.archive_dir, engine, [tweet["url"] for tweet in tweets])

    job_id = create_job(engine, input_path, len(tweets), "dry_run" if dry_run else "running")
    if dry_run or not tweets:
        finish_job(job_id, "dry_run", 0, 0, None)
        return {"job_id": job_id, "input_path": input_path, "count": len(tweets), "dry_run": True}

    command = build_command(engine, settings, input_path)
    executable = command[0]
    if shutil.which(executable) is None:
        mark_attempts(job_id, tweets, engine, "failed_retryable", 127, "command_not_found", executable)
        mark_tweets_failed([tweet["tweet_id"] for tweet in tweets], "failed_retryable", "command_not_found")
        finish_job(job_id, "failed", 0, len(tweets), f"{executable} not found")
        return {"job_id": job_id, "input_path": input_path, "count": len(tweets), "exit_code": 127}

    set_tweets_downloading([tweet["tweet_id"] for tweet in tweets])
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    stderr_excerpt = result.stderr[-4000:] if result.stderr else None

    if result.returncode == 0:
        downloaded_ids = detect_downloaded_tweet_ids(settings.archive_dir, tweets)
        downloaded = [tweet for tweet in tweets if tweet["tweet_id"] in downloaded_ids]
        missing = [tweet for tweet in tweets if tweet["tweet_id"] not in downloaded_ids]

        mark_attempts(job_id, downloaded, engine, "downloaded", 0, None, stderr_excerpt)
        mark_attempts(
            job_id,
            missing,
            engine,
            "failed_retryable",
            0,
            "no_downloaded_files",
            stderr_excerpt,
        )
        mark_tweets_downloaded([tweet["tweet_id"] for tweet in downloaded])
        mark_tweets_failed(
            [tweet["tweet_id"] for tweet in missing],
            "failed_retryable",
            "no_downloaded_files",
        )
        status = "finished" if not missing else "partial"
        finish_job(job_id, status, len(downloaded), len(missing), None if not missing else "no_downloaded_files")
    else:
        category = classify_error(result.returncode, stderr_excerpt)
        status = "failed_permanent" if category in {"not_found", "forbidden"} else "failed_retryable"
        mark_attempts(job_id, tweets, engine, status, result.returncode, category, stderr_excerpt)
        mark_tweets_failed([tweet["tweet_id"] for tweet in tweets], status, category)
        finish_job(job_id, "failed", 0, len(tweets), category)

    return {
        "job_id": job_id,
        "input_path": input_path,
        "count": len(tweets),
        "exit_code": result.returncode,
    }


def fetch_download_candidates(limit: int | None) -> list[dict[str, str]]:
    sql = """
        select tweet_id, url
        from tweets
        where download_status in ('pending', 'failed_retryable', 'missing', 'corrupt')
        order by imported_at asc
    """
    params: tuple[int, ...] = ()
    if limit:
        sql += " limit %s"
        params = (limit,)

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())


def write_input_file(archive_dir: Path, engine: str, urls: list[str]) -> Path:
    path = archive_dir / "raw" / "downloader_inputs" / f"{engine}-input.txt"
    path.write_text("\n".join(urls) + ("\n" if urls else ""), encoding="utf-8")
    return path


def build_command(engine: str, settings: Settings, input_path: Path) -> list[str]:
    if engine == "gallery-dl":
        return [
            "gallery-dl",
            "--config",
            "/app/gallery-dl.conf",
            "--destination",
            str(settings.archive_dir / "media"),
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
        "--write-info-json",
        "--write-thumbnail",
        "--download-archive",
        str(settings.archive_dir / "state" / "yt-dlp-downloaded.txt"),
        "-a",
        str(input_path),
        "-o",
        str(settings.archive_dir / "media" / "%(uploader_id)s" / "%(id)s" / "%(id)s.%(ext)s"),
    ]


def create_job(engine: str, input_path: Path, total_count: int, status: str) -> int:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into download_jobs (job_type, engine, input_path, status, total_count, started_at)
                values ('download', %s, %s, %s, %s, now())
                returning id
                """,
                (engine, normalize_path(input_path), status, total_count),
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
                        finished_at
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s, now())
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
                    ),
                )
        conn.commit()


def classify_error(exit_code: int, stderr: str | None) -> str:
    text = (stderr or "").lower()
    if "404" in text or "not found" in text:
        return "not_found"
    if "403" in text or "forbidden" in text or "unauthorized" in text:
        return "forbidden"
    if "429" in text or "rate" in text:
        return "rate_limited"
    if "timeout" in text or "timed out" in text:
        return "timeout"
    return f"exit_{exit_code}"


def detect_downloaded_tweet_ids(archive_dir: Path, tweets: list[dict[str, str]]) -> set[str]:
    tweet_ids = {tweet["tweet_id"] for tweet in tweets}
    found: set[str] = set()
    media_dir = archive_dir / "media"
    if not media_dir.exists():
        return found

    for path in media_dir.rglob("*"):
        if not path.is_file():
            continue

        path_text = path.as_posix()
        for tweet_id in tweet_ids:
            if tweet_id in path_text:
                found.add(tweet_id)

        if path.suffix != ".json":
            continue

        try:
            data = orjson.loads(path.read_bytes())
        except orjson.JSONDecodeError:
            continue

        candidate_values = {
            str(data.get("tweet_id") or ""),
            str(data.get("display_id") or ""),
            str(data.get("webpage_url_basename") or ""),
            str(data.get("webpage_url") or ""),
        }
        for tweet_id in tweet_ids:
            if any(tweet_id and tweet_id in value for value in candidate_values):
                found.add(tweet_id)

    return found
