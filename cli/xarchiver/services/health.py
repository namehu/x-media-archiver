from __future__ import annotations

from xarchiver.api.deps import stop_worker, write_lock_held
from xarchiver.db import connect, get_pool_stats


def get_health_detail() -> dict[str, object]:
    with connect() as conn:
        with conn.cursor() as cur:
            return {
                "status": "ok",
                "worker": {
                    "stop_requested": stop_worker.is_set(),
                    "write_lock_held": write_lock_held(),
                },
                "db_pool": get_pool_stats(),
                "queue": get_queue_summary(cur),
                "sources": get_source_summary(cur),
                "recent_errors": get_recent_errors(cur),
            }


def get_queue_summary(cur) -> dict[str, object]:
    cur.execute(
        """
        select status, count(*)::int as count
        from archive_run_items
        group by status
        """
    )
    item_counts = {str(row["status"]): int(row["count"]) for row in cur.fetchall()}

    cur.execute(
        """
        select status, count(*)::int as count
        from archive_runs
        group by status
        """
    )
    run_counts = {str(row["status"]): int(row["count"]) for row in cur.fetchall()}

    cur.execute(
        """
        select id, trigger_type, status, started_at, finished_at, error_message
        from archive_runs
        order by started_at desc, id desc
        limit 1
        """
    )
    latest_run = cur.fetchone()

    return {
        "pending_items": item_counts.get("pending", 0),
        "processing_items": item_counts.get("processing", 0),
        "retryable_failed_items": item_counts.get("failed_retryable", 0),
        "permanent_failed_items": item_counts.get("failed_permanent", 0),
        "queued_runs": run_counts.get("queued", 0),
        "running_runs": run_counts.get("running", 0),
        "latest_run": dict(latest_run) if latest_run else None,
    }


def get_source_summary(cur) -> dict[str, object]:
    cur.execute(
        """
        select status, count(*)::int as count
        from archive_sources
        group by status
        """
    )
    source_counts = {str(row["status"]): int(row["count"]) for row in cur.fetchall()}

    cur.execute(
        """
        select count(*)::int as count
        from archive_sources
        where cursor_state->>'automation_enabled' = 'true'
          and coalesce(cursor_state->>'automation_state', '') not in ('stopped', 'paused', 'completed')
        """
    )
    history_enabled = int(cur.fetchone()["count"])

    cur.execute(
        """
        select count(*)::int as count
        from source_scan_runs
        where status in ('running', 'waiting_downloads')
        """
    )
    active_scan_runs = int(cur.fetchone()["count"])

    cur.execute(
        """
        select id, source_id, trigger_type, status, requested_limit, error_category,
               error_message, started_at, finished_at, created_at
        from source_scan_runs
        order by created_at desc, id desc
        limit 1
        """
    )
    latest_scan = cur.fetchone()

    return {
        "active_sources": source_counts.get("active", 0),
        "paused_sources": source_counts.get("paused", 0),
        "failed_sources": source_counts.get("failed", 0),
        "history_enabled_sources": history_enabled,
        "active_scan_runs": active_scan_runs,
        "latest_scan": dict(latest_scan) if latest_scan else None,
    }


def get_recent_errors(cur, limit: int = 5) -> list[dict[str, object]]:
    cur.execute(
        """
        select 'archive_item' as kind,
               id::text as id,
               tweet_id as subject,
               archive_run_id,
               id as archive_run_item_id,
               tweet_id,
               null::bigint as source_id,
               null::bigint as source_scan_run_id,
               '/tweets/' || tweet_id as target_path,
               error_category,
               error_message,
               updated_at as occurred_at
        from archive_run_items
        where error_category is not null or error_message is not null
        union all
        select 'source_scan' as kind,
               id::text as id,
               source_id::text as subject,
               null::bigint as archive_run_id,
               null::bigint as archive_run_item_id,
               null::text as tweet_id,
               source_id,
               id as source_scan_run_id,
               '/sources?sourceId=' || source_id::text as target_path,
               error_category,
               error_message,
               coalesce(finished_at, created_at) as occurred_at
        from source_scan_runs
        where error_category is not null or error_message is not null
        order by occurred_at desc nulls last
        limit %s
        """,
        (limit,),
    )
    return [dict(row) for row in cur.fetchall()]
