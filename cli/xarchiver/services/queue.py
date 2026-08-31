"""归档队列服务。

这个模块负责围绕 archive run / item 做编排，包括提交、抢占、重试退避、
暂停恢复停止，以及 worker 租约管理。
"""

from __future__ import annotations

import logging
from contextlib import nullcontext
from pathlib import Path
from threading import Event, Thread
from typing import Any

from psycopg.types.json import Jsonb
from sqlalchemy import (
    Integer,
    and_,
    bindparam,
    case,
    delete,
    exists,
    func,
    insert,
    or_,
    select,
    update,
)
from sqlalchemy.sql import ColumnElement, Select

from xarchiver.config import Settings
from xarchiver.core.events import publish_event
from xarchiver.db import connect
from xarchiver.importer import extract_tweet_id, parse_jsonl_rows, parse_url_rows, upsert_tweets
from xarchiver.row_models import (
    ArchiveClaimedItemRow,
    ArchiveRunAttemptRow,
    ArchiveRunItemRow,
    ArchiveRunRow,
    IdRow,
    LatestItemErrorRow,
    StatusCountRow,
    TweetQueueStateRow,
    TweetStatusRow,
    UrlRow,
)
from xarchiver.services.library import get_library_snapshot
from xarchiver.services.operation_logs import redact_sensitive_text
from xarchiver.sql_builder import compile_query
from xarchiver.tables import (
    archive_run_items,
    archive_runs,
    failure_action_events,
    failure_dispositions,
    tweets,
)
from xarchiver.workflow import process_tweet_scope

logger = logging.getLogger(__name__)
LEASE_SECONDS = 60
HEARTBEAT_SECONDS = 20
ACTIVE_ITEM_STATUSES = ("pending", "blocked", "processing", "failed_retryable")
RUNNABLE_RUN_STATUSES = ("queued", "running")
SOURCE_BLOCKING_RUN_STATUSES = ("queued", "running", "paused")
FAILURE_TWEET_STATUSES = ("failed_retryable", "failed_permanent", "corrupt")


class WorkerLeaseLost(RuntimeError):
    """当已领取条目被其他 worker 接管时抛出。"""

    pass


class ArchiveItemLeaseHeartbeat:
    """后台心跳线程，用来维持已领取归档条目的租约。"""

    def __init__(self, item_ids: list[int], worker_id: str | None) -> None:
        self.item_ids = item_ids
        self.worker_id = worker_id
        self.stop = Event()
        self.lost = Event()
        self.thread: Thread | None = None

    def __enter__(self) -> ArchiveItemLeaseHeartbeat:
        if self.worker_id and self.item_ids:
            self.thread = Thread(target=self._run, name="archive-item-lease-heartbeat", daemon=True)
            self.thread.start()
        return self

    def __exit__(self, *_: object) -> None:
        self.stop.set()
        if self.thread:
            self.thread.join(timeout=2)

    def _run(self) -> None:
        while not self.stop.wait(HEARTBEAT_SECONDS):
            if not heartbeat_archive_items(self.item_ids, self.worker_id or ""):
                self.lost.set()
                return

    def ensure_active(self) -> None:
        if self.lost.is_set():
            raise WorkerLeaseLost("archive_item_lease_lost")


def submit_archive_batch(
    records: list[dict[str, Any]],
    trigger_type: str,
    input_path: str | None = None,
    source_id: int | None = None,
    *,
    _connection: Any | None = None,
    _defer_publish: bool = False,
) -> dict[str, object]:
    """规范化输入记录，并创建一个排队中的归档运行。"""

    rows = normalize_records(records, trigger_type)
    unique_rows = list({str(row["tweet_id"]): row for row in rows}.values())
    input_summary = {
        "input_record_count": len(rows),
        "unique_tweet_count": len(unique_rows),
        "duplicate_input_count": len(rows) - len(unique_rows),
    }
    counts = {
        "queued_count": 0,
        "blocked_count": 0,
        "skipped_verified_count": 0,
        "skipped_ignored_count": 0,
        "linked_pending_count": 0,
        "linked_active_count": 0,
        "skipped_completed_count": 0,
    }
    owns_connection = _connection is None
    connection_context = connect() if owns_connection else nullcontext(_connection)
    with connection_context as conn:
        with conn.cursor() as cur:
            # Every writer that combines the per-Tweet advisory lock with row
            # locks must acquire them in this order to avoid cross-process
            # advisory-lock/row-lock deadlocks.
            for tweet_id in sorted(str(row["tweet_id"]) for row in unique_rows):
                cur.execute("select pg_advisory_xact_lock(hashtextextended(%s, 0))", (tweet_id,))
        upsert_tweets(unique_rows, conn)
        with conn.cursor() as cur:
            blocked_by_run_id = find_source_blocker(cur, source_id)
            run_status = "blocked" if blocked_by_run_id else "queued"
            item_active_status = "blocked" if blocked_by_run_id else "pending"
            cur.execute(
                """
                insert into archive_runs (
                    trigger_type, source_id, input_path, status, blocked_by_run_id, result
                )
                values (%s, %s, %s, %s, %s, %s)
                returning id
                """,
                (
                    trigger_type,
                    source_id,
                    input_path,
                    run_status,
                    blocked_by_run_id,
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
            run_id = IdRow.model_validate(dict(cur.fetchone())).id
            for row in unique_rows:
                tweet_id = str(row["tweet_id"])
                cur.execute(
                    """
                    select t.download_status, (d.tweet_id is not null) as failure_ignored
                    from tweets t
                    left join failure_dispositions d on d.tweet_id = t.tweet_id
                    where t.tweet_id = %s
                    for update of t
                    """,
                    (tweet_id,),
                )
                queue_state = TweetQueueStateRow.model_validate(dict(cur.fetchone()))
                tweet_status = queue_state.download_status
                cur.execute(
                    """
                    select id from archive_run_items
                    where tweet_id = %s and status in ('pending', 'blocked', 'processing', 'failed_retryable')
                    order by id desc limit 1
                    """,
                    (tweet_id,),
                )
                active_item_row = cur.fetchone()
                active_item = IdRow.model_validate(dict(active_item_row)) if active_item_row else None
                linked_id = None
                if queue_state.failure_ignored and tweet_status in {"failed_retryable", "failed_permanent", "corrupt"}:
                    item_status = "skipped_ignored"
                    counts["skipped_ignored_count"] += 1
                    counts["skipped_completed_count"] += 1
                elif tweet_status in {"verified", "downloaded", "skipped"}:
                    item_status = "skipped_verified"
                    counts["skipped_verified_count"] += 1
                    counts["skipped_completed_count"] += 1
                elif active_item is not None:
                    item_status = "linked_pending"
                    linked_id = active_item.id
                    counts["linked_pending_count"] += 1
                    counts["linked_active_count"] += 1
                else:
                    item_status = item_active_status
                    if item_status == "blocked":
                        counts["blocked_count"] += 1
                    else:
                        counts["queued_count"] += 1
                cur.execute(
                    """
                    insert into archive_run_items (
                        archive_run_id, tweet_id, input_payload, status, linked_item_id
                    )
                    values (%s, %s, %s, %s, %s)
                    """,
                    (run_id, tweet_id, Jsonb(json_safe_value(row)), item_status, linked_id),
                )
            status = run_status if counts["queued_count"] or counts["blocked_count"] else "completed"
            result = build_run_result(input_summary, {**counts, "verified_count": 0, "failed_count": 0})
            cur.execute(
                """
                update archive_runs
                set status = %s, result = %s,
                    blocked_by_run_id = case when %s = 'completed' then null else blocked_by_run_id end,
                    finished_at = case when %s = 'completed' then now() else null end
                where id = %s
                """,
                (status, Jsonb(result), status, status, run_id),
            )
        if owns_connection:
            conn.commit()

    result = {
        "run_id": run_id,
        "status": status,
        "source_id": source_id,
        "blocked_by_run_id": blocked_by_run_id,
        "input": input_summary,
        "tasks": counts,
    }
    if not _defer_publish:
        publish_archive_submission(result, trigger_type=trigger_type, input_path=input_path)
    return result


def publish_archive_submission(
    result: dict[str, object],
    *,
    trigger_type: str,
    input_path: str | None = None,
) -> None:
    """在归档提交事务完成后发布运行事件。"""

    publish_event(
        "archive_runs",
        "archive.run.submitted",
        {
            "run_id": result["run_id"],
            "status": result["status"],
            "trigger_type": trigger_type,
            "input_path": input_path,
            "source_id": result.get("source_id"),
            "blocked_by_run_id": result.get("blocked_by_run_id"),
            "input": result["input"],
            "tasks": result["tasks"],
        },
    )


def find_source_blocker(cur, source_id: int | None, exclude_run_id: int | None = None) -> int | None:
    """返回当前阻塞同一 source 的活动或暂停运行。"""

    if source_id is None:
        return None
    params: list[object] = [source_id]
    exclude_sql = ""
    if exclude_run_id is not None:
        exclude_sql = "and id <> %s"
        params.append(exclude_run_id)
    cur.execute(
        f"""
        select id
        from archive_runs
        where source_id = %s
          {exclude_sql}
          and status in ('queued', 'running', 'paused')
        order by started_at asc, id asc
        limit 1
        for update skip locked
        """,
        tuple(params),
    )
    row = cur.fetchone()
    return int(row["id"]) if row else None


def submit_urls_file(path: Path) -> dict[str, object]:
    """解析纯文本 URL 文件，并作为一批任务加入归档队列。"""

    rows = parse_url_rows(path, "cli_urls", path.as_posix())
    return submit_archive_batch(rows, "cli_urls", path.as_posix())


def submit_jsonl_file(path: Path) -> dict[str, object]:
    """解析 JSONL 导入文件，并作为一批任务加入归档队列。"""

    rows = parse_jsonl_rows(path)
    return submit_archive_batch(rows, "cli_jsonl", path.as_posix())


def normalize_records(records: list[dict[str, Any]], trigger_type: str) -> list[dict[str, Any]]:
    """把原始输入记录转换成标准归档运行载荷结构。"""

    if not records:
        raise ValueError("records_required")
    rows: list[dict[str, Any]] = []
    for record in records:
        url = str(record.get("url") or "").strip()
        tweet_id = extract_tweet_id(url)
        raw_import = record["raw_import"] if "raw_import" in record else record
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
                "raw_import": json_safe_value(raw_import),
            }
        )
    return rows


def json_safe_value(value: Any) -> Any:
    """在入库前把嵌套值转换成 JSON 安全的基础结构。"""

    if isinstance(value, dict):
        return {str(key): json_safe_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe_value(item) for item in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def fetch_tweet_statuses(tweet_ids: list[str]) -> dict[str, str]:
    """批量读取推文当前下载状态，并按 tweet_id 建索引。"""

    if not tweet_ids:
        return {}
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select tweet_id, download_status from tweets where tweet_id = any(%s)", (tweet_ids,))
            return {
                row.tweet_id: row.download_status
                for row in (TweetStatusRow.model_validate(dict(row)) for row in cur.fetchall())
            }


def has_pending_download_work() -> bool:
    """判断队列里是否还有未收敛的归档条目，包括暂停或阻塞项。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select exists (
                  select 1 from archive_run_items
                  where status in ('pending', 'blocked', 'processing', 'failed_retryable')
                ) as pending
                """
            )
            return bool(cur.fetchone()["pending"])


def has_runnable_download_work(retry_limit: int = 3) -> bool:
    """判断是否存在当前可由 worker 领取的下载条目。"""

    runnable_item = (
        select(archive_run_items.c.id)
        .select_from(
            archive_run_items.join(
                archive_runs,
                archive_runs.c.id == archive_run_items.c.archive_run_id,
            ).outerjoin(
                failure_dispositions,
                failure_dispositions.c.tweet_id == archive_run_items.c.tweet_id,
            )
        )
        .where(
            archive_runs.c.status.in_({"queued", "running"}),
            archive_run_items.c.retry_count < retry_limit,
            archive_run_items.c.cancel_requested.is_not(True),
            failure_dispositions.c.tweet_id.is_(None),
            or_(
                archive_run_items.c.status == "pending",
                and_(
                    archive_run_items.c.status == "failed_retryable",
                    or_(
                        archive_run_items.c.next_attempt_at.is_(None),
                        archive_run_items.c.next_attempt_at <= func.now(),
                    ),
                ),
                and_(
                    archive_run_items.c.status == "processing",
                    or_(
                        archive_run_items.c.lease_expires_at.is_(None),
                        archive_run_items.c.lease_expires_at < func.now(),
                    ),
                ),
            ),
        )
        .limit(1)
    )
    statement = select(exists(runnable_item).label("runnable"))
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            return bool(cur.fetchone()["runnable"])


def process_next_queued_run(settings: Settings, worker_id: str | None = None) -> dict[str, object] | None:
    """领取下一批可运行任务，执行处理，并收敛运行状态。"""

    claimed = claim_next_items(settings.retry_limit, getattr(settings, "queue_batch_size", 20), worker_id=worker_id)
    if not claimed:
        return None
    run_id = int(claimed[0]["archive_run_id"])
    item_ids = {str(row["tweet_id"]): int(row["id"]) for row in claimed}
    tweet_ids = list(item_ids)
    log_queue_event("archive.worker.claimed", run_id=run_id, item_count=len(claimed))
    try:
        with ArchiveItemLeaseHeartbeat([int(row["id"]) for row in claimed], worker_id) as lease:
            pipeline = process_tweet_scope(tweet_ids, settings, archive_run_id=run_id, item_ids=item_ids)
            lease.ensure_active()
            update_processed_items(run_id, claimed, settings, pipeline, worker_id=worker_id)
            lease.ensure_active()
    except Exception as exc:
        # 非租约类异常会回写到已领取条目上，避免运行一直卡在 processing，
        # 同时给后续重试或收敛留出状态依据。
        if not isinstance(exc, WorkerLeaseLost):
            fail_processing_items(run_id, claimed, settings, str(exc), worker_id=worker_id)
        log_queue_event(
            "archive.worker.failed",
            run_id=run_id,
            item_count=len(claimed),
            error_type=type(exc).__name__,
        )
        raise
    detail = get_run_detail(run_id) or {}
    log_queue_event(
        "archive.worker.completed",
        run_id=run_id,
        item_count=len(claimed),
        status=detail.get("status"),
    )
    return detail


def claim_next_items(
    retry_limit: int,
    batch_size: int = 20,
    worker_id: str | None = None,
) -> list[ArchiveClaimedItemRow]:
    """为某个 worker 原子领取下一批可执行归档条目。"""

    batch_size = max(1, int(batch_size))
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                with candidate_run as (
                  select i.archive_run_id
                  from archive_run_items i
                  join archive_runs r on r.id = i.archive_run_id
                  left join failure_dispositions d on d.tweet_id = i.tweet_id
                  where (
                      i.status in ('pending', 'failed_retryable')
                      or (i.status = 'processing' and (i.lease_expires_at is null or i.lease_expires_at < now()))
                    )
                    and r.status in ('queued', 'running')
                    and i.cancel_requested is not true
                    and d.tweet_id is null
                    and i.retry_count < %s
                    and (i.next_attempt_at is null or i.next_attempt_at <= now())
                  order by r.last_dispatched_at asc nulls first, r.started_at asc, i.created_at asc, i.id asc
                  for update of i skip locked
                  limit 1
                ),
                candidate_items as materialized (
                  select i.id
                  from archive_run_items i
                  join candidate_run r on r.archive_run_id = i.archive_run_id
                  join archive_runs ar on ar.id = i.archive_run_id
                  left join failure_dispositions d on d.tweet_id = i.tweet_id
                  where (
                      i.status in ('pending', 'failed_retryable')
                      or (i.status = 'processing' and (i.lease_expires_at is null or i.lease_expires_at < now()))
                    )
                    and ar.status in ('queued', 'running')
                    and i.cancel_requested is not true
                    and d.tweet_id is null
                    and i.retry_count < %s
                    and (i.next_attempt_at is null or i.next_attempt_at <= now())
                  order by i.id asc
                  limit %s
                  for update of i skip locked
                )
                update archive_run_items
                set status = 'processing',
                    worker_id = %s,
                    claimed_at = now(),
                    lease_expires_at = now() + make_interval(secs => %s),
                    last_attempt_at = now(),
                    progress_message = '等待下载器处理',
                    last_progress_at = now(),
                    updated_at = now()
                where id in (select id from candidate_items)
                returning id, archive_run_id, tweet_id, retry_count, worker_id, cancel_requested
                """,
                (retry_limit, retry_limit, batch_size, worker_id, LEASE_SECONDS),
            )
            rows = [ArchiveClaimedItemRow.model_validate(dict(row)) for row in cur.fetchall()]
            if rows:
                run_id = int(rows[0]["archive_run_id"])
                statement = (
                    update(archive_runs)
                    .where(
                        archive_runs.c.id == run_id,
                        archive_runs.c.status.in_({"queued", "running"}),
                    )
                    .values(
                        status=case(
                            (archive_runs.c.status == "queued", "running"),
                            else_=archive_runs.c.status,
                        ),
                        finished_at=None,
                        last_dispatched_at=func.now(),
                    )
                )
                sql, params = compile_query(statement)
                cur.execute(sql, params)
        conn.commit()
    if rows:
        payload = build_archive_run_event_payload(
            int(rows[0]["archive_run_id"]),
            [int(row["id"]) for row in rows],
            {"item_count": len(rows)},
        )
        publish_event(
            "archive_runs",
            "archive.run.processing",
            payload,
        )
    return rows


def update_processed_items(
    run_id: int,
    claimed: list[dict[str, object]],
    settings: Settings,
    pipeline: dict[str, object],
    worker_id: str | None = None,
) -> None:
    """把下游推文状态回写成 archive_run_items 的最终条目状态。"""

    tweet_statuses = fetch_tweet_statuses([str(row["tweet_id"]) for row in claimed])
    item_errors = fetch_latest_item_errors([int(row["id"]) for row in claimed])
    with connect() as conn:
        with conn.cursor() as cur:
            for row in claimed:
                tweet_id = str(row["tweet_id"])
                retries = int(row["retry_count"]) + 1
                tweet_status = tweet_statuses.get(tweet_id, "failed_retryable")
                cur.execute(
                    """
                    select cancel_requested
                    from archive_run_items
                    where id = %s
                      and (%s::text is null or worker_id = %s)
                    for update
                    """,
                    (int(row["id"]), worker_id, worker_id),
                )
                current_item = cur.fetchone()
                if current_item is None:
                    raise WorkerLeaseLost("archive_item_lease_lost")
                cancel_requested = bool(current_item["cancel_requested"])
                # 队列条目的最终状态以下载流水线结束后的 tweet/media 结果为准。
                if cancel_requested and tweet_status != "verified":
                    item_status = "cancelled"
                elif tweet_status == "verified":
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
                        worker_id = null, lease_expires_at = null,
                        progress_message = case
                          when %s = 'verified' then '下载完成'
                          when %s = 'cancelled' then '已取消'
                          else progress_message
                        end,
                        last_progress_at = now(),
                        updated_at = now()
                    where id = %s
                      and (%s::text is null or worker_id = %s)
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
                        item_status,
                        item_status,
                        int(row["id"]),
                        worker_id,
                        worker_id,
                    ),
                )
                if worker_id is not None and cur.rowcount != 1:
                    raise WorkerLeaseLost("archive_item_lease_lost")
        conn.commit()
    update_run_after_processing(run_id, pipeline)
    publish_event(
        "archive_runs",
        "archive.run.items_processed",
        build_archive_run_event_payload(run_id, [int(row["id"]) for row in claimed], {"item_count": len(claimed)}),
    )


def fail_processing_items(
    run_id: int,
    claimed: list[dict[str, object]],
    settings: Settings,
    error: str,
    worker_id: str | None = None,
) -> None:
    """把当前已领取条目标记为 worker 级失败，并设置退避时间。"""

    with connect() as conn:
        with conn.cursor() as cur:
            for row in claimed:
                retries = int(row["retry_count"]) + 1
                cur.execute(
                    """
                    select cancel_requested
                    from archive_run_items
                    where id = %s
                      and (%s::text is null or worker_id = %s)
                    for update
                    """,
                    (int(row["id"]), worker_id, worker_id),
                )
                current_item = cur.fetchone()
                if current_item is None:
                    raise WorkerLeaseLost("archive_item_lease_lost")
                cancel_requested = bool(current_item["cancel_requested"])
                status = (
                    "cancelled"
                    if cancel_requested
                    else "failed_permanent" if retries >= settings.retry_limit else "failed_retryable"
                )
                cur.execute(
                    """
                    update archive_run_items
                    set status = %s, retry_count = %s,
                        next_attempt_at = case when %s = 'failed_retryable'
                          then now() + make_interval(mins => %s) else null end,
                        error_category = case when %s = 'cancelled' then null else 'worker_error' end,
                        error_message = case when %s = 'cancelled' then null else %s end,
                        worker_id = null, lease_expires_at = null,
                        progress_message = case when %s = 'cancelled' then '已取消' else %s end,
                        last_progress_at = now(),
                        updated_at = now()
                    where id = %s
                      and (%s::text is null or worker_id = %s)
                    """,
                    (
                        status,
                        retries,
                        status,
                        settings.retry_backoff_minutes * retries,
                        status,
                        status,
                        error,
                        status,
                        error,
                        int(row["id"]),
                        worker_id,
                        worker_id,
                    ),
                )
                if worker_id is not None and cur.rowcount != 1:
                    raise WorkerLeaseLost("archive_item_lease_lost")
        conn.commit()
    update_run_after_processing(run_id, None)
    publish_event(
        "archive_runs",
        "archive.run.items_failed",
        build_archive_run_event_payload(run_id, [int(row["id"]) for row in claimed], {"item_count": len(claimed)}),
    )


def update_run_after_processing(run_id: int, pipeline: dict[str, object] | None) -> None:
    """在条目状态变化后，重新计算运行状态与结果摘要。"""

    task_counts = count_run_items(run_id)
    current = get_run(run_id)
    current_status = str(current.get("status")) if current else ""
    if current_status == "stopped":
        status = "stopped"
    elif current_status == "paused" and not task_counts["processing_count"]:
        status = "paused"
    elif task_counts["pending_count"] or task_counts["processing_count"] or task_counts["failed_retryable_count"]:
        status = "queued"
    elif task_counts["cancelled_count"] and not task_counts["verified_count"] and not task_counts["failed_count"]:
        status = "stopped"
    elif task_counts["failed_count"]:
        status = "completed_with_failures"
    else:
        status = "completed"
    # 运行结果里既保存任务计数，也保存某一时刻的媒体库快照，方便 UI 在
    # 不额外做复杂关联查询的情况下稳定展示摘要。
    input_summary = current.get("result", {}).get("input", {}) if current else {}
    media = pipeline.get("media") if pipeline else None
    result = build_run_result(input_summary, task_counts, media)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update archive_runs set status = %s, result = %s,
                    finished_at = case when %s in ('completed', 'completed_with_failures', 'stopped') then now() else null end
                where id = %s
                """,
                (status, Jsonb(result), status, run_id),
            )
        conn.commit()
    if status in {"completed", "completed_with_failures", "failed", "stopped"}:
        release_next_blocked_source_run(current.get("source_id") if current else None)
    event_type = "archive.run.completed" if status in {"completed", "completed_with_failures"} else "archive.run.updated"
    publish_event(
        "archive_runs",
        event_type,
        build_archive_run_event_payload(run_id, extra={"status": status, "tasks": task_counts}),
    )


def count_run_items(run_id: int) -> dict[str, int]:
    """把队列条目按状态聚合成运行结果使用的任务摘要。"""

    counts = {
        "queued_count": 0,
        "blocked_count": 0,
        "skipped_verified_count": 0,
        "skipped_ignored_count": 0,
        "linked_pending_count": 0,
        "linked_active_count": 0,
        "skipped_completed_count": 0,
        "verified_count": 0,
        "failed_count": 0,
        "cancelled_count": 0,
        "pending_count": 0,
        "blocked_item_count": 0,
        "processing_count": 0,
        "failed_retryable_count": 0,
    }
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select status, count(*) as count from archive_run_items where archive_run_id = %s group by status",
                (run_id,),
            )
            rows = [StatusCountRow.model_validate(dict(row)) for row in cur.fetchall()]
    for row in rows:
        status = str(row["status"])
        value = int(row["count"])
        if status == "pending":
            counts["queued_count"] += value
            counts["pending_count"] += value
        elif status == "blocked":
            counts["blocked_count"] = counts.get("blocked_count", 0) + value
            counts["blocked_item_count"] += value
        elif status == "processing":
            counts["processing_count"] += value
        elif status == "failed_retryable":
            counts["failed_retryable_count"] += value
        elif status == "failed_permanent":
            counts["failed_count"] += value
        elif status == "skipped_verified":
            counts["skipped_verified_count"] += value
        elif status == "skipped_ignored":
            counts["skipped_ignored_count"] += value
        elif status == "linked_pending":
            counts["linked_pending_count"] += value
        elif status == "verified":
            counts["verified_count"] += value
        elif status == "cancelled":
            counts["cancelled_count"] += value
    return counts


def build_archive_run_event_payload(
    run_id: int,
    item_ids: list[int] | None = None,
    extra: dict[str, object] | None = None,
) -> dict[str, object]:
    """构造 runtime overlay 可消费的归档 run/item 事件载荷。"""

    payload: dict[str, object] = {"run_id": run_id, "archive_run_id": run_id}
    if extra:
        payload.update(extra)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select id, trigger_type, source_id, input_path, status, blocked_by_run_id,
                       control_state, started_at, finished_at, result, error_message
                from archive_runs
                where id = %s
                """,
                (run_id,),
            )
            run_row = cur.fetchone()
            if run_row:
                run = dict(run_row)
                payload["run"] = run
                payload["source_id"] = run.get("source_id")
                payload["status"] = payload.get("status") or run.get("status")
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
                    where i.archive_run_id = %s
                      and i.id = any(%s)
                    order by i.id
                    """,
                    (run_id, item_ids),
                )
                payload["items"] = [dict(row) for row in cur.fetchall()]
            else:
                payload.setdefault("items", [])
    return payload


def release_next_blocked_source_run(source_id: int | None) -> int | None:
    """当阻塞者清空后，释放同一 source 的下一个 blocked 运行。"""

    if source_id is None:
        return None
    with connect() as conn:
        with conn.cursor() as cur:
            blocker = find_source_blocker(cur, source_id)
            if blocker is not None:
                conn.commit()
                return None
            cur.execute(
                """
                select id
                from archive_runs
                where source_id = %s and status = 'blocked'
                order by started_at asc, id asc
                limit 1
                for update skip locked
                """,
                (source_id,),
            )
            row = cur.fetchone()
            if not row:
                conn.commit()
                return None
            run_id = int(row["id"])
            cur.execute(
                """
                update archive_run_items
                set status = 'pending',
                    progress_message = null,
                    last_progress_at = now(),
                    updated_at = now()
                where archive_run_id = %s and status = 'blocked'
                """,
                (run_id,),
            )
            cur.execute(
                """
                update archive_runs
                set status = 'queued',
                    blocked_by_run_id = null,
                    finished_at = null
                where id = %s
                """,
                (run_id,),
            )
        conn.commit()
    publish_event("archive_runs", "archive.run.unblocked", {"run_id": run_id, "source_id": source_id})
    return run_id


def fetch_latest_item_errors(item_ids: list[int]) -> dict[int, dict[str, object]]:
    """返回每个条目最新一条 download_attempt 错误信息。"""

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
            return {
                int(row.archive_run_item_id): dict(row)
                for row in (
                    LatestItemErrorRow.model_validate(dict(row))
                    for row in cur.fetchall()
                )
            }


def build_run_result(
    input_summary: dict[str, object],
    tasks: dict[str, int],
    media: dict[str, object] | None = None,
) -> dict[str, object]:
    """构造持久化到 ``archive_runs.result`` 的结果载荷。"""

    return {
        "pipeline_version": "queue-v1",
        "scope": "submitted_batch",
        "input": input_summary,
        "tasks": {
            key: int(tasks.get(key, 0))
            for key in (
                "queued_count",
                "blocked_count",
                "skipped_verified_count",
                "skipped_ignored_count",
                "linked_pending_count",
                "linked_active_count",
                "skipped_completed_count",
                "verified_count",
                "failed_count",
                "cancelled_count",
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


def list_runs(
    limit: int = 50,
    offset: int = 0,
    status: str | None = None,
    tweet_id: str | None = None,
    failed_only: bool = False,
    source_id: int | None = None,
) -> list[ArchiveRunRow]:
    """使用共享过滤构造器列出归档运行。"""

    sql, params = build_runs_query(
        status=status,
        tweet_id=tweet_id,
        failed_only=failed_only,
        source_id=source_id,
        limit=limit,
        offset=offset,
    )
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [ArchiveRunRow.model_validate(dict(row)) for row in cur.fetchall()]


def list_runs_page(
    limit: int = 50,
    offset: int = 0,
    status: str | None = None,
    tweet_id: str | None = None,
    failed_only: bool = False,
    source_id: int | None = None,
) -> dict[str, object]:
    """返回带总数信息的归档运行分页结果。"""

    rows = list_runs(limit=limit, offset=offset, status=status, tweet_id=tweet_id, failed_only=failed_only, source_id=source_id)
    total_count = count_runs(status=status, tweet_id=tweet_id, failed_only=failed_only, source_id=source_id)
    return {
        "rows": [dict(row) for row in rows],
        "count": len(rows),
        "total_count": total_count,
        "limit": limit,
        "offset": offset,
    }


def count_runs(
    status: str | None = None,
    tweet_id: str | None = None,
    failed_only: bool = False,
    source_id: int | None = None,
) -> int:
    """按与 ``list_runs`` 相同的过滤条件统计归档运行数量。"""

    sql, params = build_count_runs_query(status=status, tweet_id=tweet_id, failed_only=failed_only, source_id=source_id)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return int(cur.fetchone()["count"])


def build_runs_query(
    status: str | None = None,
    tweet_id: str | None = None,
    failed_only: bool = False,
    source_id: int | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[str, dict[str, object]]:
    """构造归档运行分页查询。"""

    statement = (
        select(
            archive_runs.c.id,
            archive_runs.c.trigger_type,
            archive_runs.c.source_id,
            archive_runs.c.input_path,
            archive_runs.c.status,
            archive_runs.c.blocked_by_run_id,
            archive_runs.c.control_state,
            archive_runs.c.started_at,
            archive_runs.c.finished_at,
            archive_runs.c.result,
            archive_runs.c.error_message,
        )
        .select_from(archive_runs)
        .order_by(archive_runs.c.started_at.desc(), archive_runs.c.id.desc())
        .limit(bindparam("limit", limit))
        .offset(bindparam("offset", offset))
    )
    statement = apply_runs_filters(
        statement,
        status=status,
        tweet_id=tweet_id,
        failed_only=failed_only,
        source_id=source_id,
    )
    return compile_query(statement)


def build_count_runs_query(
    status: str | None = None,
    tweet_id: str | None = None,
    failed_only: bool = False,
    source_id: int | None = None,
) -> tuple[str, dict[str, object]]:
    """构造与 ``build_runs_query`` 对应的数量查询。"""

    statement = select(func.count().cast(Integer).label("count")).select_from(archive_runs)
    statement = apply_runs_filters(
        statement,
        status=status,
        tweet_id=tweet_id,
        failed_only=failed_only,
        source_id=source_id,
    )
    return compile_query(statement)


def apply_runs_filters(
    statement: Select,
    status: str | None = None,
    tweet_id: str | None = None,
    failed_only: bool = False,
    source_id: int | None = None,
) -> Select:
    """把可选的运行过滤条件应用到 SQLAlchemy 语句上。"""

    filters = build_runs_filters(status=status, tweet_id=tweet_id, failed_only=failed_only, source_id=source_id)
    if not filters:
        return statement
    return statement.where(and_(*filters))


def build_runs_filters(
    status: str | None = None,
    tweet_id: str | None = None,
    failed_only: bool = False,
    source_id: int | None = None,
) -> list[ColumnElement[bool]]:
    """构造可复用的运行过滤表达式，供列表和计数查询共用。"""

    filters: list[ColumnElement[bool]] = []
    if source_id is not None:
        filters.append(archive_runs.c.source_id == bindparam("source_id", source_id))
    if status:
        filters.append(archive_runs.c.status == bindparam("run_status", status))
    if tweet_id:
        filters.append(
            exists(
                select(1)
                .select_from(archive_run_items)
                .where(
                    archive_run_items.c.archive_run_id == archive_runs.c.id,
                    archive_run_items.c.tweet_id.like(
                        bindparam("tweet_id_pattern", f"%{tweet_id}%")
                    ),
                )
            )
        )
    if failed_only:
        filters.append(
            exists(
                select(1)
                .select_from(archive_run_items)
                .where(
                    archive_run_items.c.archive_run_id == archive_runs.c.id,
                    archive_run_items.c.status.in_(("failed_retryable", "failed_permanent")),
                )
            )
        )
    return filters


def get_run(run_id: int) -> ArchiveRunRow | None:
    """按 ID 读取单个归档运行。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select id, trigger_type, source_id, input_path, status, blocked_by_run_id, control_state,
                       started_at, finished_at, result, error_message
                from archive_runs where id = %s
                """,
                (run_id,),
            )
            row = cur.fetchone()
            if not row:
                return None
            return ArchiveRunRow.model_validate(dict(row))


def get_run_detail(run_id: int) -> dict[str, object] | None:
    """读取运行详情，以及其条目和最近下载尝试。"""

    run = get_run(run_id)
    if run is None:
        return None
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select id, tweet_id, status, retry_count, error_category, error_message,
                       linked_item_id, cancel_requested, downloaded_bytes, total_bytes, speed_bps,
                       progress_message, last_progress_at, last_attempt_at, next_attempt_at,
                       created_at, updated_at
                from archive_run_items
                where archive_run_id = %s order by id
                """,
                (run_id,),
            )
            items = [ArchiveRunItemRow.model_validate(dict(row)) for row in cur.fetchall()]
            item_ids = [int(item["id"]) for item in items]
            attempts_by_item: dict[int, list[dict[str, object]]] = {item_id: [] for item_id in item_ids}
            if item_ids:
                cur.execute(
                    """
                    select a.id, a.archive_run_item_id, a.job_id, a.tweet_id, a.engine, a.status, a.exit_code,
                           a.error_category, a.error_message, a.stderr_excerpt, j.log_stream_id,
                           a.started_at, a.finished_at
                    from download_attempts a
                    left join download_jobs j on j.id = a.job_id
                    where a.archive_run_item_id = any(%s)
                    order by a.archive_run_item_id, a.id desc
                    """,
                    (item_ids,),
                )
                for attempt in cur.fetchall():
                    value = dict(attempt)
                    value["stderr_excerpt"] = redact_sensitive_text(value.get("stderr_excerpt")) or None
                    attempt_row = ArchiveRunAttemptRow.model_validate(value)
                    attempts_by_item[int(attempt_row.archive_run_item_id)].append(dict(attempt_row))
    return {
        **dict(run),
        "items": [
            {**dict(item), "attempts": attempts_by_item.get(int(item["id"]), [])}
            for item in items
        ],
    }


def retry_run(run_id: int) -> dict[str, object]:
    """基于永久失败条目创建一次新的手动重试运行。"""

    detail = get_run_detail(run_id)
    if detail is None:
        raise ValueError("archive_run_not_found")
    retryable = [
        {"url": row["url"]}
        for row in fetch_retry_urls(run_id)
    ]
    if not retryable:
        raise ValueError("archive_run_has_no_failed_items")
    result = submit_explicit_retry_batch(
        retryable,
        "manual_retry",
        original_run_id=run_id,
    )
    publish_event(
        "archive_runs",
        "archive.run.retried",
        {"run_id": result["run_id"], "original_run_id": run_id, "queued_count": result["tasks"]["queued_count"]},
    )
    return result


def pause_run(run_id: int) -> dict[str, object]:
    """暂停 queued/running/blocked 状态的运行，阻止后续继续领新任务。"""

    run = get_run(run_id)
    if run is None:
        raise ValueError("archive_run_not_found")
    if run.status not in {"queued", "running", "blocked"}:
        return {"run_id": run_id, "status": run.status, "affected_count": 0}
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update archive_runs
                set status = 'paused',
                    control_state = control_state || %s,
                    finished_at = null
                where id = %s and status in ('queued', 'running', 'blocked')
                """,
                (Jsonb({"pause_requested": True}), run_id),
            )
            affected = cur.rowcount
        conn.commit()
    publish_event("archive_runs", "archive.run.paused", build_archive_run_event_payload(run_id))
    return {"run_id": run_id, "status": "paused" if affected else run.status, "affected_count": affected}


def resume_run(run_id: int) -> dict[str, object]:
    """恢复一个已暂停运行，并遵守同 source 阻塞规则。"""

    run = get_run(run_id)
    if run is None:
        raise ValueError("archive_run_not_found")
    if run.status != "paused":
        return {"run_id": run_id, "status": run.status, "affected_count": 0}
    with connect() as conn:
        with conn.cursor() as cur:
            blocked_by_run_id = find_source_blocker(cur, run.source_id, exclude_run_id=run_id)
            status = "blocked" if blocked_by_run_id else "queued"
            item_status = "blocked" if blocked_by_run_id else "pending"
            cur.execute(
                """
                update archive_run_items
                set status = %s,
                    progress_message = null,
                    last_progress_at = now(),
                    updated_at = now()
                where archive_run_id = %s
                  and status in ('pending', 'blocked')
                """,
                (item_status, run_id),
            )
            cur.execute(
                """
                update archive_runs
                set status = %s,
                    blocked_by_run_id = %s,
                    control_state = control_state || %s,
                    finished_at = null
                where id = %s and status = 'paused'
                """,
                (status, blocked_by_run_id, Jsonb({"pause_requested": False}), run_id),
            )
            affected = cur.rowcount
        conn.commit()
    publish_event(
        "archive_runs",
        "archive.run.resumed",
        build_archive_run_event_payload(run_id, extra={"status": status}),
    )
    return {"run_id": run_id, "status": status if affected else run.status, "affected_count": affected}


def stop_run(run_id: int) -> dict[str, object]:
    """取消排队条目，并请求正在处理的条目自然停机。"""

    run = get_run(run_id)
    if run is None:
        raise ValueError("archive_run_not_found")
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update archive_run_items
                set status = 'cancelled',
                    progress_message = '已取消',
                    last_progress_at = now(),
                    updated_at = now()
                where archive_run_id = %s
                  and status in ('pending', 'blocked', 'failed_retryable')
                returning id
                """,
                (run_id,),
            )
            cancelled_item_ids = [int(row["id"]) for row in cur.fetchall()]
            cancelled = len(cancelled_item_ids)
            cur.execute(
                """
                update archive_run_items
                set cancel_requested = true,
                    progress_message = '已请求停止，当前下载会自然结束',
                    last_progress_at = now(),
                    updated_at = now()
                where archive_run_id = %s
                  and status = 'processing'
                returning id
                """,
                (run_id,),
            )
            requested_item_ids = [int(row["id"]) for row in cur.fetchall()]
            requested = len(requested_item_ids)
            cur.execute(
                """
                update archive_runs
                set status = 'stopped',
                    control_state = control_state || %s,
                    finished_at = case when %s = 0 then now() else finished_at end
                where id = %s
                """,
                (Jsonb({"stop_requested": True}), requested, run_id),
            )
        conn.commit()
    release_next_blocked_source_run(run.source_id)
    publish_event(
        "archive_runs",
        "archive.run.stopped",
        build_archive_run_event_payload(
            run_id,
            [*cancelled_item_ids, *requested_item_ids],
            {"cancelled_count": cancelled, "cancel_requested_count": requested},
        ),
    )
    return {"run_id": run_id, "status": "stopped", "affected_count": cancelled + requested}


def cancel_run_items(
    run_id: int,
    item_ids: list[int] | None = None,
    tweet_ids: list[str] | None = None,
) -> dict[str, object]:
    """只取消运行内的部分条目，而不是停止整个运行。"""

    run = get_run(run_id)
    if run is None:
        raise ValueError("archive_run_not_found")
    if not item_ids and not tweet_ids:
        raise ValueError("archive_run_items_required")
    with connect() as conn:
        with conn.cursor() as cur:
            filters = ["archive_run_id = %s"]
            params: list[object] = [run_id]
            if item_ids:
                filters.append("id = any(%s)")
                params.append(item_ids)
            if tweet_ids:
                filters.append("tweet_id = any(%s)")
                params.append(tweet_ids)
            where = " and ".join(filters)
            cur.execute(
                f"""
                update archive_run_items
                set status = 'cancelled',
                    progress_message = '已取消',
                    last_progress_at = now(),
                    updated_at = now()
                where {where}
                  and status in ('pending', 'blocked', 'failed_retryable')
                returning id
                """,
                tuple(params),
            )
            cancelled_item_ids = [int(row["id"]) for row in cur.fetchall()]
            cancelled = len(cancelled_item_ids)
            cur.execute(
                f"""
                update archive_run_items
                set cancel_requested = true,
                    progress_message = '已请求取消，当前下载会自然结束',
                    last_progress_at = now(),
                    updated_at = now()
                where {where}
                  and status = 'processing'
                returning id
                """,
                tuple(params),
            )
            requested_item_ids = [int(row["id"]) for row in cur.fetchall()]
            requested = len(requested_item_ids)
        conn.commit()
    update_run_after_processing(run_id, None)
    publish_event(
        "archive_runs",
        "archive.run.items_cancelled",
        build_archive_run_event_payload(
            run_id,
            [*cancelled_item_ids, *requested_item_ids],
            {"cancelled_count": cancelled, "cancel_requested_count": requested},
        ),
    )
    return {"run_id": run_id, "status": (get_run(run_id) or run).status, "affected_count": cancelled + requested}


def submit_requeue_batch(statuses: list[str], limit: int | None = None) -> dict[str, object]:
    """把指定终态中的推文重新放回队列。"""

    sql, params = build_requeue_urls_query(statuses=statuses, limit=limit)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = [UrlRow.model_validate(dict(row)) for row in cur.fetchall()]
    if not rows:
        return {"requeued": 0, "statuses": statuses}
    return submit_explicit_retry_batch([{"url": row["url"]} for row in rows], "manual_requeue")


def build_requeue_urls_query(statuses: list[str], limit: int | None = None) -> tuple[str, dict[str, object]]:
    """构造批量重新入队使用的查询语句。"""

    statement = (
        select(tweets.c.url)
        .select_from(tweets)
        .where(tweets.c.download_status.in_(statuses))
        .order_by(tweets.c.updated_at.asc(), tweets.c.imported_at.asc())
    )
    if limit:
        statement = statement.limit(bindparam("limit", limit))
    return compile_query(statement)


def fetch_retry_urls(run_id: int) -> list[UrlRow]:
    """读取某次历史运行中永久失败条目的 URL。"""

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
            return [UrlRow.model_validate(dict(row)) for row in cur.fetchall()]


def submit_explicit_retry_batch(
    records: list[dict[str, Any]],
    trigger_type: str,
    *,
    original_run_id: int | None = None,
) -> dict[str, object]:
    """原子清理失败处置、重置 Tweet，并创建可审计重试运行。"""

    normalized = normalize_records(records, trigger_type)
    tweet_ids = sorted({str(row["tweet_id"]) for row in normalized})
    with connect() as conn:
        with conn.cursor() as cur:
            for tweet_id in tweet_ids:
                cur.execute("select pg_advisory_xact_lock(hashtextextended(%s, 0))", (tweet_id,))
            cur.execute(
                """
                select tweet_id, download_status
                from tweets
                where tweet_id = any(%s)
                order by tweet_id
                for update
                """,
                (tweet_ids,),
            )
            previous_statuses = {
                str(row["tweet_id"]): str(row["download_status"])
                for row in cur.fetchall()
            }
            statement = delete(failure_dispositions).where(failure_dispositions.c.tweet_id.in_(tweet_ids))
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            cur.execute(
                """
                update tweets set download_status = 'pending', last_error = null, updated_at = now()
                where tweet_id = any(%s)
                """,
                (tweet_ids,),
            )
            result = submit_archive_batch(
                records,
                trigger_type,
                _connection=conn,
                _defer_publish=True,
            )
            for tweet_id, previous_status in previous_statuses.items():
                if previous_status not in FAILURE_TWEET_STATUSES:
                    continue
                event_statement = insert(failure_action_events).values(
                    tweet_id=tweet_id,
                    action="retry",
                    previous_status=previous_status,
                    archive_run_id=int(result["run_id"]),
                    result=Jsonb(
                        {
                            "trigger_type": trigger_type,
                            "original_run_id": original_run_id,
                        }
                    ),
                    created_at=func.now(),
                )
                sql, params = compile_query(event_statement)
                cur.execute(sql, params)
        conn.commit()
    publish_archive_submission(result, trigger_type=trigger_type)
    return result


def log_queue_event(event: str, **details: object) -> None:
    """通过 Python logger 输出结构化队列日志事件。"""

    logger.info("归档队列事件：%s", event, extra={"event": event, "details": details})


def heartbeat_archive_items(item_ids: list[int], worker_id: str) -> bool:
    """为当前 worker 已领取的归档条目续租。"""

    if not item_ids:
        return True
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update archive_run_items
                set lease_expires_at = now() + make_interval(secs => %s),
                    updated_at = now()
                where id = any(%s) and worker_id = %s and status = 'processing'
                """,
                (LEASE_SECONDS, item_ids, worker_id),
            )
            updated = cur.rowcount
        conn.commit()
    return updated == len(item_ids)


def count_expired_archive_item_leases() -> int:
    """统计处理租约已经过期的归档条目数。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select count(*)::int as count
                from archive_run_items
                where status = 'processing' and (lease_expires_at is null or lease_expires_at < now())
                """
            )
            return int(cur.fetchone()["count"])
