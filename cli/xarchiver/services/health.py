"""诊断接口使用的健康详情聚合服务。"""

from __future__ import annotations

from xarchiver.api.deps import stop_worker, write_lock_held
from xarchiver.db import connect, get_pool_stats
from xarchiver.row_models import (
    QueueLatestRunRow,
    RecentErrorRow,
    SourceLatestScanRow,
    StatusCountRow,
)


def get_health_detail() -> dict[str, object]:
    """健康检查主入口，聚合 worker 状态、数据库连接池、队列、来源及最近错误信息。"""
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
    """归档队列概览：各状态的条目数、各状态的运行数及最近一次运行记录。"""

    # 按状态统计 archive_run_items 数量
    cur.execute(
        """
        select status, count(*)::int as count
        from archive_run_items
        group by status
        """
    )
    item_counts = {
        row.status: row.count
        for row in (StatusCountRow.model_validate(dict(row)) for row in cur.fetchall())
    }

    # 按状态统计 archive_runs 数量
    cur.execute(
        """
        select status, count(*)::int as count
        from archive_runs
        group by status
        """
    )
    run_counts = {
        row.status: row.count
        for row in (StatusCountRow.model_validate(dict(row)) for row in cur.fetchall())
    }

    # 获取最近一次归档运行记录
    cur.execute(
        """
        select id, trigger_type, status, started_at, finished_at, error_message
        from archive_runs
        order by started_at desc, id desc
        limit 1
        """
    )
    latest_run_row = cur.fetchone()
    latest_run = (
        QueueLatestRunRow.model_validate(dict(latest_run_row))
        if latest_run_row
        else None
    )

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
    """归档来源概览：各状态的来源数、开启历史记录来源数、活跃扫描数及最近一次扫描记录。"""

    # 按状态统计 archive_sources 数量
    cur.execute(
        """
        select status, count(*)::int as count
        from archive_sources
        where deleted_at is null
        group by status
        """
    )
    source_counts = {
        row.status: row.count
        for row in (StatusCountRow.model_validate(dict(row)) for row in cur.fetchall())
    }

    # 统计已开启自动化且处于活跃状态的来源数（排除 stopped / paused / completed）
    cur.execute(
        """
        select count(*)::int as count
        from archive_sources
        where cursor_state->>'automation_enabled' = 'true'
          and deleted_at is null
          and coalesce(cursor_state->>'automation_state', '') not in ('stopped', 'paused', 'completed')
        """
    )
    history_enabled = int(cur.fetchone()["count"])

    # 统计当前进行中的扫描运行数
    cur.execute(
        """
        select count(*)::int as count
        from source_scan_runs r
        join archive_sources s on s.id = r.source_id
        where r.status in ('running', 'waiting_downloads')
          and s.deleted_at is null
        """
    )
    active_scan_runs = int(cur.fetchone()["count"])

    # 获取最近一次扫描运行记录
    cur.execute(
        """
        select r.id, r.source_id, r.trigger_type, r.status, r.requested_limit, r.error_category,
               r.error_message, r.started_at, r.finished_at, r.created_at
        from source_scan_runs r
        join archive_sources s on s.id = r.source_id
        where s.deleted_at is null
        order by r.created_at desc, r.id desc
        limit 1
        """
    )
    latest_scan_row = cur.fetchone()
    latest_scan = (
        SourceLatestScanRow.model_validate(dict(latest_scan_row))
        if latest_scan_row
        else None
    )

    return {
        "active_sources": source_counts.get("active", 0),
        "paused_sources": source_counts.get("paused", 0),
        "failed_sources": source_counts.get("failed", 0),
        "history_enabled_sources": history_enabled,
        "active_scan_runs": active_scan_runs,
        "latest_scan": dict(latest_scan) if latest_scan else None,
    }


def get_recent_errors(cur, limit: int = 5) -> list[dict[str, object]]:
    """获取最近错误记录，合并 archive_run_items 和 source_scan_runs 两表的错误数据。"""

    # 使用 union all 合并两类错误来源，按发生时间倒序取最近若干条
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
    return [dict(RecentErrorRow.model_validate(dict(row))) for row in cur.fetchall()]
