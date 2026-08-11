"""失败工作台查询、精确处置与审计服务。"""

from __future__ import annotations

from collections import Counter

from psycopg.types.json import Jsonb
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as postgresql_insert

from xarchiver.core.events import publish_event
from xarchiver.db import connect
from xarchiver.exporter import (
    fetch_failure_aggregates,
    fetch_failure_categories,
    fetch_failure_rows,
)
from xarchiver.row_models import FailureActionEventRow, FailureRow, FailureTargetRow
from xarchiver.services.queue import build_run_result, update_run_after_processing
from xarchiver.sql_builder import compile_query
from xarchiver.tables import (
    archive_run_items,
    archive_runs,
    failure_action_events,
    failure_dispositions,
    tweets,
)

FAILURE_STATUSES = ("failed_retryable", "failed_permanent", "corrupt")
FAILURE_REASONS = ("not_needed", "unavailable", "unsupported", "duplicate", "other")
MAX_FAILURE_ACTION_ITEMS = 100


def list_failures(
    limit: int = 100,
    offset: int = 0,
    *,
    disposition: str = "open",
    statuses: list[str] | None = None,
    error_category: str | None = None,
    search: str | None = None,
    sort: str = "recent",
) -> dict[str, object]:
    """返回带总数信息的失败记录分页结果。"""

    rows: list[FailureRow] = fetch_failure_rows(
        limit=limit,
        offset=offset,
        disposition=disposition,
        statuses=statuses,
        error_category=error_category,
        search=search,
        sort=sort,
    )
    aggregates = fetch_failure_aggregates(
        disposition=disposition,
        statuses=statuses,
        error_category=error_category,
        search=search,
    )
    categories = fetch_failure_categories(
        disposition=disposition,
        statuses=statuses,
        error_category=error_category,
        search=search,
    )
    disposition_counts = fetch_failure_aggregates(
        disposition="all",
        statuses=statuses,
        error_category=error_category,
        search=search,
    )
    return {
        "rows": [dict(row) for row in rows],
        "count": len(rows),
        "total_count": aggregates.total_count,
        "limit": limit,
        "offset": offset,
        "aggregates": dict(aggregates),
        "disposition_counts": dict(disposition_counts),
        "error_categories": [dict(category) for category in categories],
    }


def list_failure_actions(tweet_id: str, limit: int = 100) -> dict[str, object]:
    """按时间倒序返回单条 Tweet 的失败处置事件。"""

    statement = (
        select(failure_action_events)
        .where(failure_action_events.c.tweet_id == tweet_id)
        .order_by(failure_action_events.c.created_at.desc(), failure_action_events.c.id.desc())
        .limit(limit)
    )
    sql, params = compile_query(statement)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = [FailureActionEventRow.model_validate(dict(row)) for row in cur.fetchall()]
    return {"rows": [dict(row) for row in rows], "count": len(rows)}


def ignore_failures(tweet_ids: list[str], reason: str | None = None, note: str | None = None) -> dict[str, object]:
    """忽略精确选择的失败 Tweet，并停止其尚未完成的活动条目。"""

    selected = normalize_tweet_ids(tweet_ids)
    if reason is not None and reason not in FAILURE_REASONS:
        raise ValueError("invalid_failure_reason")
    if note is not None and len(note) > 500:
        raise ValueError("failure_note_too_long")
    skip_reasons: Counter[str] = Counter()
    affected_run_ids: set[int] = set()
    succeeded_ids: list[str] = []
    cancelled_items = 0
    cancel_requested_items = 0
    with connect() as conn:
        with conn.cursor() as cur:
            for tweet_id in selected:
                lock_failure_target(cur, tweet_id)
                target = fetch_failure_target(cur, tweet_id)
                if target is None:
                    skip_reasons["not_found"] += 1
                    continue
                disposition_statement = select(failure_dispositions.c.tweet_id).where(
                    failure_dispositions.c.tweet_id == tweet_id
                )
                sql, params = compile_query(disposition_statement)
                cur.execute(sql, params)
                already_ignored = cur.fetchone() is not None
                if target.download_status not in FAILURE_STATUSES and not already_ignored:
                    skip_reasons["not_failure"] += 1
                    continue

                run_statement = select(archive_run_items.c.archive_run_id).where(
                    archive_run_items.c.tweet_id == tweet_id,
                    archive_run_items.c.status.in_(("pending", "blocked", "processing", "failed_retryable")),
                )
                sql, params = compile_query(run_statement)
                cur.execute(sql, params)
                affected_run_ids.update(int(row["archive_run_id"]) for row in cur.fetchall())

                cancel_statement = (
                    update(archive_run_items)
                    .where(
                        archive_run_items.c.tweet_id == tweet_id,
                        archive_run_items.c.status.in_(("pending", "blocked", "failed_retryable")),
                    )
                    .values(
                        status="cancelled",
                        next_attempt_at=None,
                        progress_message="失败项已忽略",
                        last_progress_at=func.now(),
                        updated_at=func.now(),
                    )
                )
                sql, params = compile_query(cancel_statement)
                cur.execute(sql, params)
                target_cancelled_items = cur.rowcount
                cancelled_items += target_cancelled_items

                request_cancel_statement = (
                    update(archive_run_items)
                    .where(
                        archive_run_items.c.tweet_id == tweet_id,
                        archive_run_items.c.status == "processing",
                    )
                    .values(
                        cancel_requested=True,
                        progress_message="失败项已忽略，当前下载会自然停止",
                        last_progress_at=func.now(),
                        updated_at=func.now(),
                    )
                )
                sql, params = compile_query(request_cancel_statement)
                cur.execute(sql, params)
                target_cancel_requested_items = cur.rowcount
                cancel_requested_items += target_cancel_requested_items

                # Idempotent calls still converge any newly-created or
                # recovered work to cancellation before reporting the item as
                # already ignored.
                if already_ignored:
                    skip_reasons["already_ignored"] += 1
                    continue

                disposition_statement = postgresql_insert(failure_dispositions).values(
                    tweet_id=tweet_id,
                    reason=reason,
                    note=note,
                    ignored_at=func.now(),
                    updated_at=func.now(),
                )
                disposition_statement = disposition_statement.on_conflict_do_update(
                    index_elements=[failure_dispositions.c.tweet_id],
                    set_={"reason": reason, "note": note, "updated_at": func.now()},
                )
                sql, params = compile_query(disposition_statement)
                cur.execute(sql, params)
                insert_failure_event(
                    cur,
                    tweet_id=tweet_id,
                    action="ignore",
                    previous_status=target.download_status,
                    reason=reason,
                    note=note,
                    result={
                        "cancelled_items": target_cancelled_items,
                        "cancel_requested_items": target_cancel_requested_items,
                    },
                )
                succeeded_ids.append(tweet_id)
        conn.commit()

    refresh_affected_runs(affected_run_ids)
    publish_failure_update("failure.ignored", succeeded_ids)
    return action_result(selected, succeeded_ids, skip_reasons, cancelled_items=cancelled_items, cancel_requested_items=cancel_requested_items)


def restore_failures(tweet_ids: list[str]) -> dict[str, object]:
    """恢复精确选择的已忽略失败项，但不自动创建下载运行。"""

    selected = normalize_tweet_ids(tweet_ids)
    skip_reasons: Counter[str] = Counter()
    succeeded_ids: list[str] = []
    with connect() as conn:
        with conn.cursor() as cur:
            for tweet_id in selected:
                lock_failure_target(cur, tweet_id)
                target = fetch_failure_target(cur, tweet_id)
                if target is None:
                    skip_reasons["not_found"] += 1
                    continue
                if target.download_status not in FAILURE_STATUSES:
                    skip_reasons["not_failure"] += 1
                    continue
                statement = delete(failure_dispositions).where(failure_dispositions.c.tweet_id == tweet_id)
                sql, params = compile_query(statement)
                cur.execute(sql, params)
                if cur.rowcount != 1:
                    skip_reasons["not_ignored"] += 1
                    continue
                insert_failure_event(
                    cur,
                    tweet_id=tweet_id,
                    action="restore",
                    previous_status=target.download_status,
                    result={},
                )
                succeeded_ids.append(tweet_id)
        conn.commit()

    publish_failure_update("failure.restored", succeeded_ids)
    return action_result(selected, succeeded_ids, skip_reasons)


def retry_failures(tweet_ids: list[str]) -> dict[str, object]:
    """立即为精确选择的失败 Tweet 创建一次新的手动重试运行。"""

    selected = normalize_tweet_ids(tweet_ids)
    skip_reasons: Counter[str] = Counter()
    retry_targets: list[FailureTargetRow] = []
    cancelled_by_tweet: dict[str, int] = {}
    affected_run_ids: set[int] = set()
    cancelled_items = 0
    run_id: int | None = None
    with connect() as conn:
        with conn.cursor() as cur:
            for tweet_id in selected:
                lock_failure_target(cur, tweet_id)
                target = fetch_failure_target(cur, tweet_id)
                if target is None:
                    skip_reasons["not_found"] += 1
                    continue
                if target.download_status not in FAILURE_STATUSES:
                    skip_reasons["not_failure"] += 1
                    continue
                processing_statement = select(archive_run_items.c.id).where(
                    archive_run_items.c.tweet_id == tweet_id,
                    archive_run_items.c.status == "processing",
                )
                sql, params = compile_query(processing_statement)
                cur.execute(sql, params)
                if cur.fetchone():
                    skip_reasons["processing"] += 1
                    continue

                run_statement = select(archive_run_items.c.archive_run_id).where(
                    archive_run_items.c.tweet_id == tweet_id,
                    archive_run_items.c.status.in_(("pending", "blocked", "failed_retryable")),
                )
                sql, params = compile_query(run_statement)
                cur.execute(sql, params)
                affected_run_ids.update(int(row["archive_run_id"]) for row in cur.fetchall())
                cancel_statement = (
                    update(archive_run_items)
                    .where(
                        archive_run_items.c.tweet_id == tweet_id,
                        archive_run_items.c.status.in_(("pending", "blocked", "failed_retryable")),
                    )
                    .values(
                        status="cancelled",
                        next_attempt_at=None,
                        progress_message="已由手动重试替代",
                        last_progress_at=func.now(),
                        updated_at=func.now(),
                    )
                )
                sql, params = compile_query(cancel_statement)
                cur.execute(sql, params)
                cancelled_items += cur.rowcount
                cancelled_by_tweet[tweet_id] = cur.rowcount
                retry_targets.append(target)

            if retry_targets:
                retry_ids = [target.tweet_id for target in retry_targets]
                clear_disposition_statement = delete(failure_dispositions).where(
                    failure_dispositions.c.tweet_id.in_(retry_ids)
                )
                sql, params = compile_query(clear_disposition_statement)
                cur.execute(sql, params)
                reset_statement = (
                    update(tweets)
                    .where(tweets.c.tweet_id.in_(retry_ids))
                    .values(
                        download_status="pending",
                        last_error=None,
                        retry_count=0,
                        last_attempt_at=None,
                        updated_at=func.now(),
                    )
                )
                sql, params = compile_query(reset_statement)
                cur.execute(sql, params)

                input_summary = {
                    "input_record_count": len(retry_targets),
                    "unique_tweet_count": len(retry_targets),
                    "duplicate_input_count": 0,
                }
                tasks = {
                    "queued_count": len(retry_targets),
                    "blocked_count": 0,
                    "skipped_verified_count": 0,
                    "skipped_ignored_count": 0,
                    "linked_pending_count": 0,
                    "linked_active_count": 0,
                    "skipped_completed_count": 0,
                    "verified_count": 0,
                    "failed_count": 0,
                    "cancelled_count": 0,
                }
                run_statement = (
                    insert(archive_runs)
                    .values(
                        trigger_type="manual_retry",
                        status="queued",
                        result=Jsonb(build_run_result(input_summary, tasks)),
                    )
                    .returning(archive_runs.c.id)
                )
                sql, params = compile_query(run_statement)
                cur.execute(sql, params)
                run_id = int(cur.fetchone()["id"])
                item_statement = insert(archive_run_items)
                for target in retry_targets:
                    sql, params = compile_query(
                        item_statement.values(
                            archive_run_id=run_id,
                            tweet_id=target.tweet_id,
                            input_payload=Jsonb({"url": target.url}),
                            status="pending",
                            retry_count=0,
                        )
                    )
                    cur.execute(sql, params)
                    insert_failure_event(
                        cur,
                        tweet_id=target.tweet_id,
                        action="retry",
                        previous_status=target.download_status,
                        archive_run_id=run_id,
                        result={"cancelled_items": cancelled_by_tweet[target.tweet_id]},
                    )
        conn.commit()

    refresh_affected_runs(affected_run_ids)
    succeeded_ids = [target.tweet_id for target in retry_targets]
    if run_id is not None:
        publish_event(
            "archive_runs",
            "archive.run.submitted",
            {
                "run_id": run_id,
                "status": "queued",
                "trigger_type": "manual_retry",
                "input": {"input_record_count": len(retry_targets), "unique_tweet_count": len(retry_targets)},
                "tasks": {"queued_count": len(retry_targets)},
            },
        )
    publish_failure_update("failure.retried", succeeded_ids, run_id=run_id)
    return action_result(selected, succeeded_ids, skip_reasons, run_id=run_id, cancelled_items=cancelled_items)


def normalize_tweet_ids(tweet_ids: list[str]) -> list[str]:
    selected = list(dict.fromkeys(value.strip() for value in tweet_ids if value.strip()))
    if not selected:
        raise ValueError("failure_tweet_ids_required")
    if len(selected) > MAX_FAILURE_ACTION_ITEMS:
        raise ValueError("too_many_failure_items")
    return sorted(selected)


def lock_failure_target(cursor, tweet_id: str) -> None:
    # PostgreSQL advisory locks serialize precise per-Tweet actions across processes.
    cursor.execute("select pg_advisory_xact_lock(hashtextextended(%s, 0))", (tweet_id,))


def fetch_failure_target(cursor, tweet_id: str) -> FailureTargetRow | None:
    statement = (
        select(tweets.c.tweet_id, tweets.c.url, tweets.c.download_status)
        .where(tweets.c.tweet_id == tweet_id)
        .with_for_update()
    )
    sql, params = compile_query(statement)
    cursor.execute(sql, params)
    row = cursor.fetchone()
    return FailureTargetRow.model_validate(dict(row)) if row else None


def insert_failure_event(
    cursor,
    *,
    tweet_id: str,
    action: str,
    previous_status: str,
    result: dict[str, object],
    reason: str | None = None,
    note: str | None = None,
    archive_run_id: int | None = None,
) -> None:
    statement = insert(failure_action_events).values(
        tweet_id=tweet_id,
        action=action,
        previous_status=previous_status,
        reason=reason,
        note=note,
        archive_run_id=archive_run_id,
        result=Jsonb(result),
        created_at=func.now(),
    )
    sql, params = compile_query(statement)
    cursor.execute(sql, params)


def refresh_affected_runs(run_ids: set[int]) -> None:
    for run_id in sorted(run_ids):
        update_run_after_processing(run_id, None)


def publish_failure_update(event_type: str, tweet_ids: list[str], *, run_id: int | None = None) -> None:
    if not tweet_ids:
        return
    publish_event(
        "library",
        event_type,
        {"tweet_ids": tweet_ids, "affected_count": len(tweet_ids), "run_id": run_id},
    )


def action_result(
    requested_ids: list[str],
    succeeded_ids: list[str],
    skip_reasons: Counter[str],
    **extra: object,
) -> dict[str, object]:
    return {
        "requested_count": len(requested_ids),
        "succeeded_count": len(succeeded_ids),
        "skipped_count": sum(skip_reasons.values()),
        "skip_reasons": dict(skip_reasons),
        **extra,
    }
