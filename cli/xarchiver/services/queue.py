from __future__ import annotations

from pathlib import Path
from typing import Any

from psycopg.types.json import Jsonb

from xarchiver.config import Settings
from xarchiver.db import connect
from xarchiver.importer import extract_tweet_id, parse_jsonl_rows, parse_url_rows, upsert_tweets
from xarchiver.services.library import get_library_snapshot
from xarchiver.workflow import process_tweet_scope


def submit_archive_batch(
    records: list[dict[str, Any]],
    trigger_type: str,
    input_path: str | None = None,
) -> dict[str, object]:
    rows = normalize_records(records, trigger_type)
    unique_rows = list({str(row["tweet_id"]): row for row in rows}.values())
    input_summary = {
        "input_record_count": len(rows),
        "unique_tweet_count": len(unique_rows),
        "duplicate_input_count": len(rows) - len(unique_rows),
    }
    counts = {"queued_count": 0, "skipped_verified_count": 0, "linked_pending_count": 0}
    with connect() as conn:
        upsert_tweets(unique_rows, conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into archive_runs (trigger_type, input_path, status, result)
                values (%s, %s, 'queued', %s)
                returning id
                """,
                (
                    trigger_type,
                    input_path,
                    Jsonb(
                        build_run_result(
                            input_summary,
                            {
                                "queued_count": 0,
                                "skipped_verified_count": 0,
                                "linked_pending_count": 0,
                                "verified_count": 0,
                                "failed_count": 0,
                            },
                        )
                    ),
                ),
            )
            run_id = int(cur.fetchone()["id"])
            for row in unique_rows:
                tweet_id = str(row["tweet_id"])
                cur.execute("select pg_advisory_xact_lock(hashtextextended(%s, 0))", (tweet_id,))
                cur.execute("select download_status from tweets where tweet_id = %s for update", (tweet_id,))
                tweet_status = str(cur.fetchone()["download_status"])
                cur.execute(
                    """
                    select id from archive_run_items
                    where tweet_id = %s and status in ('pending', 'processing', 'failed_retryable')
                    order by id desc limit 1
                    """,
                    (tweet_id,),
                )
                active_item = cur.fetchone()
                linked_id = None
                if tweet_status == "verified":
                    item_status = "skipped_verified"
                    counts["skipped_verified_count"] += 1
                elif active_item is not None:
                    item_status = "linked_pending"
                    linked_id = int(active_item["id"])
                    counts["linked_pending_count"] += 1
                else:
                    item_status = "pending"
                    counts["queued_count"] += 1
                cur.execute(
                    """
                    insert into archive_run_items (
                        archive_run_id, tweet_id, input_payload, status, linked_item_id
                    )
                    values (%s, %s, %s, %s, %s)
                    """,
                    (run_id, tweet_id, Jsonb(row), item_status, linked_id),
                )
            status = "queued" if counts["queued_count"] else "completed"
            result = build_run_result(input_summary, {**counts, "verified_count": 0, "failed_count": 0})
            cur.execute(
                """
                update archive_runs
                set status = %s, result = %s,
                    finished_at = case when %s = 'completed' then now() else null end
                where id = %s
                """,
                (status, Jsonb(result), status, run_id),
            )
        conn.commit()

    return {
        "run_id": run_id,
        "status": status,
        "input": input_summary,
        "tasks": counts,
    }


def submit_urls_file(path: Path) -> dict[str, object]:
    rows = parse_url_rows(path, "cli_urls", path.as_posix())
    return submit_archive_batch(rows, "cli_urls", path.as_posix())


def submit_jsonl_file(path: Path) -> dict[str, object]:
    rows = parse_jsonl_rows(path)
    return submit_archive_batch(rows, "cli_jsonl", path.as_posix())


def normalize_records(records: list[dict[str, Any]], trigger_type: str) -> list[dict[str, Any]]:
    if not records:
        raise ValueError("records_required")
    rows: list[dict[str, Any]] = []
    for record in records:
        url = str(record.get("url") or "").strip()
        tweet_id = extract_tweet_id(url)
        rows.append(
            {
                "tweet_id": tweet_id,
                "url": url,
                "author_username": record.get("author_username"),
                "author_display_name": record.get("author_display_name"),
                "published_at": record.get("published_at") or record.get("datetime"),
                "text": record.get("text"),
                "source_type": record.get("source_type") or trigger_type,
                "source_url": record.get("source_url"),
                "collected_at": record.get("collected_at"),
                "raw_import": record,
            }
        )
    return rows


def fetch_tweet_statuses(tweet_ids: list[str]) -> dict[str, str]:
    if not tweet_ids:
        return {}
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select tweet_id, download_status from tweets where tweet_id = any(%s)", (tweet_ids,))
            return {str(row["tweet_id"]): str(row["download_status"]) for row in cur.fetchall()}


def process_next_queued_run(settings: Settings) -> dict[str, object] | None:
    claimed = claim_next_items(settings.retry_limit)
    if not claimed:
        return None
    run_id = int(claimed[0]["archive_run_id"])
    item_ids = {str(row["tweet_id"]): int(row["id"]) for row in claimed}
    tweet_ids = list(item_ids)
    try:
        pipeline = process_tweet_scope(tweet_ids, settings, archive_run_id=run_id, item_ids=item_ids)
        update_processed_items(run_id, claimed, settings, pipeline)
    except Exception as exc:
        fail_processing_items(run_id, claimed, settings, str(exc))
        raise
    return get_run_detail(run_id) or {}


def claim_next_items(retry_limit: int) -> list[dict[str, object]]:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select archive_run_id
                from archive_run_items
                where status in ('pending', 'failed_retryable')
                  and retry_count < %s
                  and (next_attempt_at is null or next_attempt_at <= now())
                order by created_at asc, id asc
                for update skip locked
                limit 1
                """,
                (retry_limit,),
            )
            row = cur.fetchone()
            if row is None:
                return []
            run_id = int(row["archive_run_id"])
            cur.execute(
                """
                update archive_run_items
                set status = 'processing', last_attempt_at = now(), updated_at = now()
                where archive_run_id = %s
                  and status in ('pending', 'failed_retryable')
                  and retry_count < %s
                  and (next_attempt_at is null or next_attempt_at <= now())
                returning id, archive_run_id, tweet_id, retry_count
                """,
                (run_id, retry_limit),
            )
            rows = list(cur.fetchall())
            cur.execute(
                "update archive_runs set status = 'running', finished_at = null where id = %s",
                (run_id,),
            )
        conn.commit()
    return rows


def update_processed_items(
    run_id: int,
    claimed: list[dict[str, object]],
    settings: Settings,
    pipeline: dict[str, object],
) -> None:
    tweet_statuses = fetch_tweet_statuses([str(row["tweet_id"]) for row in claimed])
    item_errors = fetch_latest_item_errors([int(row["id"]) for row in claimed])
    with connect() as conn:
        with conn.cursor() as cur:
            for row in claimed:
                tweet_id = str(row["tweet_id"])
                retries = int(row["retry_count"]) + 1
                tweet_status = tweet_statuses.get(tweet_id, "failed_retryable")
                if tweet_status == "verified":
                    item_status = "verified"
                elif tweet_status == "failed_permanent" or retries >= settings.retry_limit:
                    item_status = "failed_permanent"
                else:
                    item_status = "failed_retryable"
                delay_minutes = settings.retry_backoff_minutes * retries
                latest_error = item_errors.get(int(row["id"]), {})
                error_category = latest_error.get("error_category") or tweet_status
                error_message = latest_error.get("error_message") or latest_error.get("stderr_excerpt") or tweet_status
                cur.execute(
                    """
                    update archive_run_items
                    set status = %s, retry_count = %s,
                        next_attempt_at = case when %s = 'failed_retryable'
                          then now() + make_interval(mins => %s) else null end,
                        error_category = case when %s = 'verified' then null else %s end,
                        error_message = case when %s = 'verified' then null else %s end,
                        updated_at = now()
                    where id = %s
                    """,
                    (
                        item_status,
                        retries,
                        item_status,
                        delay_minutes,
                        item_status,
                        error_category,
                        item_status,
                        error_message,
                        int(row["id"]),
                    ),
                )
        conn.commit()
    update_run_after_processing(run_id, pipeline)


def fail_processing_items(run_id: int, claimed: list[dict[str, object]], settings: Settings, error: str) -> None:
    with connect() as conn:
        with conn.cursor() as cur:
            for row in claimed:
                retries = int(row["retry_count"]) + 1
                status = "failed_permanent" if retries >= settings.retry_limit else "failed_retryable"
                cur.execute(
                    """
                    update archive_run_items
                    set status = %s, retry_count = %s,
                        next_attempt_at = case when %s = 'failed_retryable'
                          then now() + make_interval(mins => %s) else null end,
                        error_category = 'worker_error', error_message = %s, updated_at = now()
                    where id = %s
                    """,
                    (status, retries, status, settings.retry_backoff_minutes * retries, error, int(row["id"])),
                )
        conn.commit()
    update_run_after_processing(run_id, None)


def update_run_after_processing(run_id: int, pipeline: dict[str, object] | None) -> None:
    task_counts = count_run_items(run_id)
    if task_counts["pending_count"] or task_counts["processing_count"] or task_counts["failed_retryable_count"]:
        status = "queued"
    elif task_counts["failed_count"]:
        status = "completed_with_failures"
    else:
        status = "completed"
    current = get_run(run_id)
    input_summary = current.get("result", {}).get("input", {}) if current else {}
    media = pipeline.get("media") if pipeline else None
    result = build_run_result(input_summary, task_counts, media)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update archive_runs set status = %s, result = %s,
                    finished_at = case when %s in ('completed', 'completed_with_failures') then now() else null end
                where id = %s
                """,
                (status, Jsonb(result), status, run_id),
            )
        conn.commit()


def count_run_items(run_id: int) -> dict[str, int]:
    counts = {
        "queued_count": 0,
        "skipped_verified_count": 0,
        "linked_pending_count": 0,
        "verified_count": 0,
        "failed_count": 0,
        "pending_count": 0,
        "processing_count": 0,
        "failed_retryable_count": 0,
    }
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select status, count(*) as count from archive_run_items where archive_run_id = %s group by status",
                (run_id,),
            )
            rows = list(cur.fetchall())
    for row in rows:
        status = str(row["status"])
        value = int(row["count"])
        if status == "pending":
            counts["queued_count"] += value
            counts["pending_count"] += value
        elif status == "processing":
            counts["processing_count"] += value
        elif status == "failed_retryable":
            counts["failed_retryable_count"] += value
        elif status == "failed_permanent":
            counts["failed_count"] += value
        elif status == "skipped_verified":
            counts["skipped_verified_count"] += value
        elif status == "linked_pending":
            counts["linked_pending_count"] += value
        elif status == "verified":
            counts["verified_count"] += value
    return counts


def fetch_latest_item_errors(item_ids: list[int]) -> dict[int, dict[str, object]]:
    if not item_ids:
        return {}
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select distinct on (archive_run_item_id)
                       archive_run_item_id, error_category, error_message, stderr_excerpt
                from download_attempts
                where archive_run_item_id = any(%s)
                order by archive_run_item_id, finished_at desc nulls last, id desc
                """,
                (item_ids,),
            )
            return {int(row["archive_run_item_id"]): dict(row) for row in cur.fetchall()}


def build_run_result(
    input_summary: dict[str, object],
    tasks: dict[str, int],
    media: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "pipeline_version": "queue-v1",
        "scope": "submitted_batch",
        "input": input_summary,
        "tasks": {
            key: int(tasks.get(key, 0))
            for key in (
                "queued_count",
                "skipped_verified_count",
                "linked_pending_count",
                "verified_count",
                "failed_count",
            )
        },
        "media": media
        or {
            "backfilled_media_count": 0,
            "verified_media_count": 0,
            "missing_media_count": 0,
            "corrupt_media_count": 0,
        },
        "library_snapshot": get_library_snapshot(),
    }


def list_runs(limit: int = 50) -> list[dict[str, object]]:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select id, trigger_type, input_path, status, started_at, finished_at, result, error_message
                from archive_runs order by started_at desc, id desc limit %s
                """,
                (limit,),
            )
            return list(cur.fetchall())


def get_run(run_id: int) -> dict[str, object] | None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select id, trigger_type, input_path, status, started_at, finished_at, result, error_message
                from archive_runs where id = %s
                """,
                (run_id,),
            )
            return cur.fetchone()


def get_run_detail(run_id: int) -> dict[str, object] | None:
    run = get_run(run_id)
    if run is None:
        return None
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select id, tweet_id, status, retry_count, error_category, error_message,
                       linked_item_id, last_attempt_at, next_attempt_at, created_at, updated_at
                from archive_run_items
                where archive_run_id = %s order by id
                """,
                (run_id,),
            )
            items = list(cur.fetchall())
            item_ids = [int(item["id"]) for item in items]
            attempts_by_item: dict[int, list[dict[str, object]]] = {item_id: [] for item_id in item_ids}
            if item_ids:
                cur.execute(
                    """
                    select id, archive_run_item_id, job_id, tweet_id, engine, status, exit_code,
                           error_category, error_message, started_at, finished_at
                    from download_attempts
                    where archive_run_item_id = any(%s)
                    order by archive_run_item_id, id desc
                    """,
                    (item_ids,),
                )
                for attempt in cur.fetchall():
                    attempts_by_item[int(attempt["archive_run_item_id"])].append(dict(attempt))
    return {**run, "items": [{**dict(item), "attempts": attempts_by_item.get(int(item["id"]), [])} for item in items]}


def retry_run(run_id: int) -> dict[str, object]:
    detail = get_run_detail(run_id)
    if detail is None:
        raise ValueError("archive_run_not_found")
    retryable = [
        {"url": row["url"]}
        for row in fetch_retry_urls(run_id)
    ]
    if not retryable:
        raise ValueError("archive_run_has_no_failed_items")
    reset_tweets_for_retry([extract_tweet_id(str(row["url"])) for row in retryable])
    return submit_archive_batch(retryable, "manual_retry")


def submit_requeue_batch(statuses: list[str], limit: int | None = None) -> dict[str, object]:
    sql = """
        select url from tweets
        where download_status = any(%s)
        order by updated_at asc, imported_at asc
    """
    params: list[object] = [statuses]
    if limit:
        sql += " limit %s"
        params.append(limit)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = list(cur.fetchall())
    if not rows:
        return {"requeued": 0, "statuses": statuses}
    tweet_ids = [extract_tweet_id(str(row["url"])) for row in rows]
    reset_tweets_for_retry(tweet_ids)
    return submit_archive_batch([{"url": row["url"]} for row in rows], "manual_requeue")


def fetch_retry_urls(run_id: int) -> list[dict[str, object]]:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select t.url
                from archive_run_items i
                join tweets t on t.tweet_id = i.tweet_id
                where i.archive_run_id = %s and i.status = 'failed_permanent'
                """,
                (run_id,),
            )
            return list(cur.fetchall())


def reset_tweets_for_retry(tweet_ids: list[str]) -> None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update tweets set download_status = 'pending', last_error = null, updated_at = now()
                where tweet_id = any(%s)
                """,
                (tweet_ids,),
            )
        conn.commit()
