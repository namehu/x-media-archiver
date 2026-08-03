"""WebUI runtime snapshot 聚合服务。"""

from __future__ import annotations

from xarchiver.api.deps import stop_worker, write_lock_held
from xarchiver.core.events import event_broker
from xarchiver.db import connect
from xarchiver.services.health import get_queue_summary, get_source_summary

RECENT_RUNTIME_WINDOW_SECONDS = 120
RUNTIME_ITEM_LIMIT = 500
RUNTIME_RUN_LIMIT = 100
RUNTIME_SCAN_LIMIT = 50

ACTIVE_RUN_STATUSES = ("queued", "running", "paused", "blocked")
ACTIVE_ITEM_STATUSES = ("pending", "blocked", "processing", "failed_retryable")
ACTIVE_SCAN_STATUSES = ("running", "waiting_downloads")


def get_runtime_snapshot() -> dict[str, object]:
    """返回短生命周期运行态快照。"""

    epoch, sequence = event_broker.watermark()
    with connect() as conn:
        with conn.cursor() as cur:
            runs = get_runtime_runs(cur)
            items = get_runtime_items(cur)
            scans = get_runtime_scans(cur)
            queue = get_queue_summary(cur)
            sources = get_source_summary(cur)
            return {
                "epoch": epoch,
                "sequence": sequence,
                "recent_window_seconds": RECENT_RUNTIME_WINDOW_SECONDS,
                "worker": {
                    "stop_requested": stop_worker.is_set(),
                    "write_lock_held": write_lock_held(),
                },
                "queue": queue,
                "sources": sources,
                "global": build_global_summary(runs, items, scans),
                "runs": runs,
                "items": items,
                "scans": scans,
                "recent_activity": [],
            }


def get_runtime_runs(cur) -> list[dict[str, object]]:
    """聚合活跃与最近变化的归档 run。"""

    # Runtime snapshot 是一个只读聚合端点，跨 archive_runs / archive_run_items /
    # download_jobs 做窗口化投影；固定 SQL 比分散 Core 子查询更清晰且便于维护水位语义。
    cur.execute(
        """
        with progress as (
          select archive_run_id,
                 coalesce(sum(downloaded_bytes), 0)::bigint as downloaded_bytes,
                 nullif(sum(total_bytes), 0)::bigint as total_bytes,
                 nullif(sum(speed_bps) filter (where status = 'processing'), 0)::bigint as speed_bps,
                 count(*) filter (where status in ('pending', 'blocked', 'processing', 'failed_retryable'))::int
                   as active_item_count
          from archive_run_items
          group by archive_run_id
        ),
        current_jobs as (
          select distinct on (archive_run_id)
                 archive_run_id, id as job_id, current_tweet_id, status as job_status, last_progress_at
          from download_jobs
          where archive_run_id is not null
          order by archive_run_id, last_progress_at desc nulls last, id desc
        )
        select r.id, r.trigger_type, r.source_id, r.input_path, r.status, r.blocked_by_run_id,
               r.control_state, r.started_at, r.finished_at, r.result, r.error_message,
               p.downloaded_bytes, p.total_bytes, p.speed_bps, coalesce(p.active_item_count, 0)::int as active_item_count,
               j.job_id, j.current_tweet_id, j.job_status, j.last_progress_at
        from archive_runs r
        left join progress p on p.archive_run_id = r.id
        left join current_jobs j on j.archive_run_id = r.id
        where r.status = any(%s)
           or r.finished_at >= now() - (%s * interval '1 second')
           or exists (
                select 1 from archive_run_items i
                where i.archive_run_id = r.id
                  and coalesce(i.last_progress_at, i.updated_at, i.created_at)
                      >= now() - (%s * interval '1 second')
           )
        order by case when r.status = any(%s) then 0 else 1 end,
                 coalesce(j.last_progress_at, r.finished_at, r.started_at) desc nulls last,
                 r.id desc
        limit %s
        """,
        (
            list(ACTIVE_RUN_STATUSES),
            RECENT_RUNTIME_WINDOW_SECONDS,
            RECENT_RUNTIME_WINDOW_SECONDS,
            list(ACTIVE_RUN_STATUSES),
            RUNTIME_RUN_LIMIT,
        ),
    )
    return [dict(row) for row in cur.fetchall()]


def get_runtime_items(cur) -> list[dict[str, object]]:
    """聚合活跃与最近变化的归档 item overlay。"""

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
        where i.status = any(%s)
           or coalesce(i.last_progress_at, i.updated_at, i.created_at)
              >= now() - (%s * interval '1 second')
        order by case when i.status = any(%s) then 0 else 1 end,
                 coalesce(i.last_progress_at, i.updated_at, i.created_at) desc nulls last,
                 i.id desc
        limit %s
        """,
        (
            list(ACTIVE_ITEM_STATUSES),
            RECENT_RUNTIME_WINDOW_SECONDS,
            list(ACTIVE_ITEM_STATUSES),
            RUNTIME_ITEM_LIMIT,
        ),
    )
    return [dict(row) for row in cur.fetchall()]


def get_runtime_scans(cur) -> list[dict[str, object]]:
    """聚合活跃与最近变化的来源扫描 run。"""

    cur.execute(
        """
        select r.id, r.source_id, r.trigger_type, r.status, r.range_start, r.range_end,
               r.requested_limit, r.cursor_before, r.cursor_after, r.discovered_tweet_count,
               r.new_tweet_count, r.duplicate_tweet_count, r.discovered_media_count,
               r.error_category, r.error_message, r.progress_message, r.log_stream_id,
               l.log_path, r.last_log_at, r.started_at, r.finished_at, r.created_at
        from source_scan_runs r
        join archive_sources s on s.id = r.source_id
        left join operation_log_streams l on l.id = r.log_stream_id
        where s.deleted_at is null
          and (
            r.status = any(%s)
            or coalesce(r.finished_at, r.last_log_at, r.started_at, r.created_at)
               >= now() - (%s * interval '1 second')
          )
        order by case when r.status = any(%s) then 0 else 1 end,
                 coalesce(r.last_log_at, r.finished_at, r.started_at, r.created_at) desc nulls last,
                 r.id desc
        limit %s
        """,
        (
            list(ACTIVE_SCAN_STATUSES),
            RECENT_RUNTIME_WINDOW_SECONDS,
            list(ACTIVE_SCAN_STATUSES),
            RUNTIME_SCAN_LIMIT,
        ),
    )
    return [dict(row) for row in cur.fetchall()]


def build_global_summary(
    runs: list[dict[str, object]],
    items: list[dict[str, object]],
    scans: list[dict[str, object]],
) -> dict[str, object]:
    """根据 snapshot 行构造全局运行态摘要。"""

    active_runs = [run for run in runs if run.get("status") in ACTIVE_RUN_STATUSES]
    active_items = [item for item in items if item.get("status") in ACTIVE_ITEM_STATUSES]
    active_scans = [scan for scan in scans if scan.get("status") in ACTIVE_SCAN_STATUSES]
    current_run = next((run for run in active_runs if run.get("current_tweet_id")), active_runs[0] if active_runs else None)
    speed_bps = sum(int(item.get("speed_bps") or 0) for item in active_items if item.get("status") == "processing")
    downloaded_bytes = sum(int(item.get("downloaded_bytes") or 0) for item in active_items)
    total_values = [int(item["total_bytes"]) for item in active_items if item.get("total_bytes")]
    return {
        "active_run_count": len(active_runs),
        "active_item_count": len(active_items),
        "active_scan_count": len(active_scans),
        "current_run_id": current_run.get("id") if current_run else None,
        "current_source_id": current_run.get("source_id") if current_run else None,
        "current_tweet_id": current_run.get("current_tweet_id") if current_run else None,
        "downloaded_bytes": downloaded_bytes,
        "total_bytes": sum(total_values) if total_values else None,
        "speed_bps": speed_bps or None,
    }
