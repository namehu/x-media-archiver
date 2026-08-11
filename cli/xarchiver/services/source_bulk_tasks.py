"""持久化来源批量任务、定时策略与后台编排。

模块对路由和 worker 暴露少量任务级接口，来源选择快照、逐来源状态、
扫描与下载阶段衔接、定时补跑合并等实现细节都保留在模块内部。
"""

from __future__ import annotations

import random
from datetime import UTC, datetime, timedelta
from datetime import time as dt_time
from typing import Any, TypedDict
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from psycopg.errors import UniqueViolation
from psycopg.types.json import Jsonb
from sqlalchemy import delete, func, insert, or_, select, update

from xarchiver.config import Settings, get_settings
from xarchiver.core.events import publish_event
from xarchiver.db import connect
from xarchiver.row_models import SourceBulkTaskItemRow, SourceBulkTaskRow, SourceSchedulePolicyRow
from xarchiver.services.queue import pause_run, resume_run, stop_run
from xarchiver.services.sources import (
    get_source,
    list_sources,
    start_source_scan_session,
    stop_source_scan_session,
    submit_source_downloads,
)
from xarchiver.sql_builder import compile_query
from xarchiver.tables import (
    archive_run_items,
    archive_runs,
    archive_sources,
    source_bulk_task_items,
    source_bulk_tasks,
    source_discovered_tweets,
    source_scan_runs,
    source_schedule_policies,
    source_schedule_policy_sources,
    tweets,
)

VALID_TASK_TYPES = {"refresh_latest", "download_missing", "refresh_and_download_new"}
VALID_TASK_TRIGGERS = {"manual", "scheduled", "retry"}
VALID_TASK_CONTROLS = {"pause", "resume", "cancel"}
VALID_POLICY_ACTIONS = {"refresh_latest", "refresh_and_download_new"}
VALID_FREQUENCY_KINDS = {"interval", "daily", "weekly"}
ACTIVE_TASK_STATUSES = {"queued", "running", "pausing", "paused", "blocked"}
ACTIVE_ITEM_STATUSES = {"queued", "scanning", "waiting_download", "downloading"}
TERMINAL_ITEM_STATUSES = {"succeeded", "skipped", "failed", "cancelled"}
SCANNABLE_SOURCE_TYPES = {"profile", "user_media", "likes"}
DEFAULT_WAVE_SIZE = 10
MAX_SOURCE_COUNT = 200
DEFAULT_MANUAL_CONFIRM_THRESHOLD = 500
MAX_SCHEDULE_DOWNLOADS_PER_SOURCE = 50
MAX_SCHEDULE_DOWNLOADS_PER_TASK = 1000
AUTH_CIRCUIT_BREAKER_THRESHOLD = 3
AUTH_BLOCKING_CATEGORIES = {"auth_required", "rate_limited"}


class SourceSelectionFilter(TypedDict, total=False):
    """批量任务创建时冻结的来源查询条件与审计来源。"""

    status: str
    source_type: str
    deleted: str
    sort_by: str
    sort_direction: str
    search: str
    operational_filter: str
    exclude_source_ids: list[int]
    schedule_policy_id: int
    retry_of_task_id: int


class SourceBulkTaskOptions(TypedDict, total=False):
    """写入任务快照的受控编排选项。"""

    wave_size: int
    scan_limit: int
    manual_confirm_threshold: int
    max_downloads_per_source: int
    max_downloads_per_task: int
    confirm_large_download: bool
    scheduled: bool
    estimated_download_count: int


def create_source_bulk_task(
    task_type: str,
    *,
    source_ids: list[int] | None = None,
    source_filter: SourceSelectionFilter | None = None,
    options: SourceBulkTaskOptions | None = None,
    trigger_type: str = "manual",
    schedule_policy_id: int | None = None,
) -> dict[str, object]:
    """冻结来源成员并创建一个可恢复的批量任务。"""

    normalized_type = normalize_task_type(task_type)
    normalized_trigger = normalize_task_trigger(trigger_type)
    normalized_filter = dict(source_filter or {})
    normalized_options = normalize_task_options(options, get_settings())
    if source_ids is None and source_filter is None:
        raise ValueError("source_bulk_task_sources_required")
    resolved_source_ids = resolve_source_ids(source_ids, normalized_filter)
    if not resolved_source_ids:
        raise ValueError("source_bulk_task_sources_required")
    if len(resolved_source_ids) > MAX_SOURCE_COUNT:
        raise ValueError("source_bulk_task_too_many_sources")
    if (
        normalized_trigger in {"manual", "retry"}
        and normalized_type == "download_missing"
        and not normalized_options.get("scheduled")
    ):
        missing_count = count_missing_downloads(resolved_source_ids)
        threshold = int(normalized_options["manual_confirm_threshold"])
        if missing_count > threshold and not normalized_options.get("confirm_large_download"):
            raise ValueError("source_bulk_task_large_download_confirmation_required")
        normalized_options["estimated_download_count"] = missing_count

    task_statement = (
        insert(source_bulk_tasks)
        .values(
            task_type=normalized_type,
            trigger_type=normalized_trigger,
            status="queued",
            schedule_policy_id=schedule_policy_id,
            source_filter=Jsonb(normalized_filter),
            options=Jsonb(normalized_options),
            total_count=len(resolved_source_ids),
            created_at=func.now(),
            updated_at=func.now(),
        )
        .returning(source_bulk_tasks)
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(task_statement)
            cur.execute(sql, params)
            task = SourceBulkTaskRow.model_validate(dict(cur.fetchone()))
            item_values = [
                {
                    "task_id": task.id,
                    "source_id": source_id,
                    "position": position,
                    "wave_index": (position - 1) // int(normalized_options["wave_size"]),
                    "status": "queued",
                }
                for position, source_id in enumerate(resolved_source_ids, start=1)
            ]
            sql, params = compile_query(insert(source_bulk_task_items).values(item_values))
            cur.execute(sql, params)
        conn.commit()
    publish_event(
        "source_bulk_tasks",
        "source_bulk_task.created",
        {"task_id": task.id, "task_type": normalized_type, "total_count": len(resolved_source_ids)},
    )
    return get_source_bulk_task(task.id) or dict(task)


def list_source_bulk_tasks(limit: int = 20, offset: int = 0) -> dict[str, object]:
    """分页返回批量任务及聚合结果。"""

    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    statement = select(source_bulk_tasks).order_by(source_bulk_tasks.c.created_at.desc()).limit(limit).offset(offset)
    count_statement = select(func.count(source_bulk_tasks.c.id).label("count"))
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            tasks = [SourceBulkTaskRow.model_validate(dict(row)) for row in cur.fetchall()]
            sql, params = compile_query(count_statement)
            cur.execute(sql, params)
            total_count = int(cur.fetchone()["count"])
    rows = [build_task_payload(task) for task in tasks]
    return {"rows": rows, "count": len(rows), "total_count": total_count, "limit": limit, "offset": offset}


def get_source_bulk_task(task_id: int) -> dict[str, object] | None:
    """读取任务、来源任务项与状态计数。"""

    task_statement = select(source_bulk_tasks).where(source_bulk_tasks.c.id == task_id)
    items_statement = (
        select(source_bulk_task_items, archive_sources.c.label, archive_sources.c.author_username)
        .select_from(
            source_bulk_task_items.join(
                archive_sources,
                archive_sources.c.id == source_bulk_task_items.c.source_id,
            )
        )
        .where(source_bulk_task_items.c.task_id == task_id)
        .order_by(source_bulk_task_items.c.position.asc())
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(task_statement)
            cur.execute(sql, params)
            row = cur.fetchone()
            if row is None:
                return None
            task = SourceBulkTaskRow.model_validate(dict(row))
            sql, params = compile_query(items_statement)
            cur.execute(sql, params)
            raw_items = [dict(item) for item in cur.fetchall()]
    payload = build_task_payload(task)
    payload["items"] = [serialize_task_item(item) for item in raw_items]
    return payload


def control_source_bulk_task(task_id: int, action: str) -> dict[str, object]:
    """暂停、恢复或取消批量任务。"""

    normalized_action = action.strip().lower()
    if normalized_action not in VALID_TASK_CONTROLS:
        raise ValueError("invalid_source_bulk_task_control")
    task = fetch_task_row(task_id)
    if task is None:
        raise ValueError("source_bulk_task_not_found")
    if normalized_action == "pause":
        if task.status not in {"queued", "running"}:
            raise ValueError("source_bulk_task_not_pauseable")
        set_task_status(task_id, "pausing")
        pause_task_downloads(task_id)
        set_task_status(task_id, "paused")
    elif normalized_action == "resume":
        if task.status not in {"paused", "blocked"}:
            raise ValueError("source_bulk_task_not_resumable")
        if task.status == "blocked":
            requeue_blocked_auth_items(task_id)
        resume_task_downloads(task_id)
        clear_task_blocking_errors(task_id)
        set_task_status(task_id, "running")
    else:
        if task.status in {"completed", "completed_with_issues", "cancelled"}:
            raise ValueError("source_bulk_task_not_cancellable")
        cancel_source_bulk_task(task_id)
    publish_event(
        "source_bulk_tasks",
        f"source_bulk_task.{normalized_action}",
        {"task_id": task_id},
    )
    return get_source_bulk_task(task_id) or {}


def retry_source_bulk_task(task_id: int, *, confirm_large_download: bool = False) -> dict[str, object]:
    """用原任务失败项快照创建重试任务。"""

    task = fetch_task_row(task_id)
    if task is None:
        raise ValueError("source_bulk_task_not_found")
    statement = select(source_bulk_task_items.c.source_id).where(
        source_bulk_task_items.c.task_id == task_id,
        source_bulk_task_items.c.status == "failed",
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            source_ids = [int(row["source_id"]) for row in cur.fetchall()]
    if not source_ids:
        raise ValueError("source_bulk_task_no_failed_items")
    retry_options = dict(task.options)
    retry_options["confirm_large_download"] = bool(
        confirm_large_download or retry_options.get("confirm_large_download")
    )
    return create_source_bulk_task(
        task.task_type,
        source_ids=source_ids,
        source_filter={"retry_of_task_id": task_id},
        options=retry_options,
        trigger_type="retry",
    )


def advance_source_bulk_tasks(settings: Settings | None = None) -> dict[str, object] | None:
    """推进一个任务的非网络阶段，并派发当前波次的来源工作。"""

    settings = settings or get_settings()
    process_due_source_schedules(settings)
    finalize_scanning_items()
    finalize_downloading_items()
    task = fetch_next_active_task()
    if task is None:
        return None
    if task.status == "queued":
        start_task(task.id)
        task = fetch_task_row(task.id) or task
    if task.status == "pausing":
        pause_task_downloads(task.id)
        set_task_status(task.id, "paused")
        return get_source_bulk_task(task.id)
    if task.status != "running":
        return build_task_payload(task)
    if circuit_breaker_triggered(task.id):
        block_task(task.id, "source_bulk_task_auth_circuit_open")
        return get_source_bulk_task(task.id)
    dispatch_current_wave(task, settings)
    finalize_task_if_settled(task.id)
    return get_source_bulk_task(task.id)


def has_due_source_scan() -> bool:
    """判断是否存在允许被 worker 继续处理的到期扫描。"""

    task_allowed = or_(
        archive_sources.c.cursor_state["bulk_task_item_id"].astext.is_(None),
        select(source_bulk_tasks.c.id)
        .select_from(
            source_bulk_task_items.join(
                source_bulk_tasks,
                source_bulk_tasks.c.id == source_bulk_task_items.c.task_id,
            )
        )
        .where(
            source_bulk_task_items.c.id
            == archive_sources.c.cursor_state["bulk_task_item_id"].astext.cast(source_bulk_task_items.c.id.type),
            source_bulk_tasks.c.status == "running",
            source_bulk_task_items.c.status == "scanning",
        )
        .exists(),
    )
    statement = select(archive_sources.c.id).where(
        archive_sources.c.status == "active",
        archive_sources.c.deleted_at.is_(None),
        archive_sources.c.cursor_state["automation_enabled"].astext == "true",
        or_(archive_sources.c.next_scan_at.is_(None), archive_sources.c.next_scan_at <= func.now()),
        task_allowed,
    ).limit(1)
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            return cur.fetchone() is not None


def create_source_schedule_policy(
    *,
    label: str,
    action: str,
    frequency_kind: str,
    interval_minutes: int | None = None,
    local_time: str | None = None,
    weekday: int | None = None,
    timezone: str = "Asia/Shanghai",
    jitter_seconds: int = 300,
    max_downloads_per_source: int = 50,
    max_downloads_per_task: int = 1000,
    enabled: bool = False,
    source_ids: list[int] | None = None,
    source_filter: SourceSelectionFilter | None = None,
) -> dict[str, object]:
    """创建命名定时策略并可选地分配来源。"""

    values = normalize_policy_values(
        label=label,
        action=action,
        frequency_kind=frequency_kind,
        interval_minutes=interval_minutes,
        local_time=local_time,
        weekday=weekday,
        timezone=timezone,
        jitter_seconds=jitter_seconds,
        max_downloads_per_source=max_downloads_per_source,
        max_downloads_per_task=max_downloads_per_task,
        enabled=enabled,
    )
    if enabled:
        values["next_run_at"] = calculate_next_policy_run(values, datetime.now(UTC))
    resolved_source_ids = resolve_source_ids(source_ids, dict(source_filter or {})) if (source_ids or source_filter) else []
    statement = insert(source_schedule_policies).values(**values).returning(source_schedule_policies)
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            policy = SourceSchedulePolicyRow.model_validate(dict(cur.fetchone()))
            if resolved_source_ids:
                assignments = [
                    {"policy_id": policy.id, "source_id": source_id}
                    for source_id in resolved_source_ids
                ]
                sql, params = compile_query(insert(source_schedule_policy_sources).values(assignments))
                cur.execute(sql, params)
        conn.commit()
    if resolved_source_ids:
        publish_event(
            "source_schedules",
            "source_schedule_policy.assigned",
            {"policy_id": policy.id, "source_count": len(resolved_source_ids)},
        )
    return get_source_schedule_policy(policy.id) or dict(policy)


def update_source_schedule_policy(policy_id: int, values: dict[str, object]) -> dict[str, object]:
    """更新定时策略，并在启用或节奏变化时重算下一次执行。"""

    current = fetch_policy_row(policy_id)
    if current is None:
        raise ValueError("source_schedule_policy_not_found")
    required_fields = {
        "label",
        "action",
        "frequency_kind",
        "timezone",
        "jitter_seconds",
        "max_downloads_per_source",
        "max_downloads_per_task",
        "enabled",
    }
    if any(field in values and values[field] is None for field in required_fields):
        raise ValueError("source_schedule_policy_required_field")
    merged = {**dict(current), **values}
    normalized = normalize_policy_values(
        label=str(merged["label"]),
        action=str(merged["action"]),
        frequency_kind=str(merged["frequency_kind"]),
        interval_minutes=to_optional_int(merged.get("interval_minutes")),
        local_time=str(merged["local_time"]) if merged.get("local_time") is not None else None,
        weekday=to_optional_int(merged.get("weekday")),
        timezone=str(merged["timezone"]),
        jitter_seconds=int(merged["jitter_seconds"]),
        max_downloads_per_source=int(merged["max_downloads_per_source"]),
        max_downloads_per_task=int(merged["max_downloads_per_task"]),
        enabled=bool(merged["enabled"]),
    )
    normalized["updated_at"] = func.now()
    normalized["next_run_at"] = (
        calculate_next_policy_run(normalized, datetime.now(UTC)) if normalized["enabled"] else None
    )
    statement = (
        update(source_schedule_policies)
        .where(source_schedule_policies.c.id == policy_id)
        .values(**normalized)
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
        conn.commit()
    return get_source_schedule_policy(policy_id) or {}


def assign_source_schedule_policy(policy_id: int, source_ids: list[int]) -> dict[str, object]:
    """用冻结来源集合替换策略成员。"""

    if fetch_policy_row(policy_id) is None:
        raise ValueError("source_schedule_policy_not_found")
    normalized_ids = normalize_source_ids(source_ids)
    if not normalized_ids:
        raise ValueError("source_schedule_policy_sources_required")
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(
                delete(source_schedule_policy_sources).where(
                    source_schedule_policy_sources.c.policy_id == policy_id
                )
            )
            cur.execute(sql, params)
            values = [{"policy_id": policy_id, "source_id": source_id} for source_id in normalized_ids]
            sql, params = compile_query(insert(source_schedule_policy_sources).values(values))
            cur.execute(sql, params)
        conn.commit()
    publish_event(
        "source_schedules",
        "source_schedule_policy.assigned",
        {"policy_id": policy_id, "source_count": len(normalized_ids)},
    )
    return get_source_schedule_policy(policy_id) or {}


def list_source_schedule_policies() -> list[dict[str, object]]:
    """列出定时策略及成员数量。"""

    statement = (
        select(
            source_schedule_policies,
            func.count(source_schedule_policy_sources.c.source_id).label("source_count"),
        )
        .select_from(
            source_schedule_policies.outerjoin(
                source_schedule_policy_sources,
                source_schedule_policy_sources.c.policy_id == source_schedule_policies.c.id,
            )
        )
        .group_by(source_schedule_policies.c.id)
        .order_by(source_schedule_policies.c.created_at.desc())
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            return [serialize_policy(dict(row)) for row in cur.fetchall()]


def get_source_schedule_policy(policy_id: int) -> dict[str, object] | None:
    """读取策略和已分配来源 ID。"""

    policy = fetch_policy_row(policy_id)
    if policy is None:
        return None
    statement = (
        select(source_schedule_policy_sources.c.source_id)
        .where(source_schedule_policy_sources.c.policy_id == policy_id)
        .order_by(source_schedule_policy_sources.c.source_id.asc())
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            source_ids = [int(row["source_id"]) for row in cur.fetchall()]
    return {**serialize_policy(dict(policy)), "source_ids": source_ids, "source_count": len(source_ids)}


def delete_source_schedule_policy(policy_id: int) -> None:
    """删除策略；已创建的历史任务保留且外键置空。"""

    statement = delete(source_schedule_policies).where(source_schedule_policies.c.id == policy_id)
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            if cur.rowcount == 0:
                raise ValueError("source_schedule_policy_not_found")
        conn.commit()


def process_due_source_schedules(settings: Settings | None = None) -> int:
    """把到期策略合并为至多一个新的批量任务。"""

    _ = settings or get_settings()
    statement = (
        select(source_schedule_policies)
        .where(
            source_schedule_policies.c.enabled.is_(True),
            source_schedule_policies.c.next_run_at.is_not(None),
            source_schedule_policies.c.next_run_at <= func.now(),
        )
        .order_by(source_schedule_policies.c.next_run_at.asc())
        .with_for_update(skip_locked=True)
        .limit(10)
    )
    created = 0
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            policies = [SourceSchedulePolicyRow.model_validate(dict(row)) for row in cur.fetchall()]
        conn.commit()
    for policy in policies:
        if schedule_has_active_task(policy.id):
            # 保留已经到期的 next_run_at 作为 durable coalescing marker；旧任务
            # 收敛后的下一次 tick 会补跑一次，再把锚点推进到未来。
            continue
        source_ids = fetch_policy_source_ids(policy.id)
        if source_ids:
            options = {
                "wave_size": DEFAULT_WAVE_SIZE,
                "max_downloads_per_source": policy.max_downloads_per_source,
                "max_downloads_per_task": policy.max_downloads_per_task,
                "scheduled": True,
            }
            try:
                create_source_bulk_task(
                    policy.action,
                    source_ids=source_ids,
                    source_filter={"schedule_policy_id": policy.id},
                    options=options,
                    trigger_type="scheduled",
                    schedule_policy_id=policy.id,
                )
                created += 1
            except UniqueViolation:
                # 多 API 进程同时观察到同一个到期策略时，唯一索引负责合并成一次。
                pass
        advance_policy_anchor(policy)
    return created


def normalize_task_type(value: str) -> str:
    normalized = value.strip().lower()
    if normalized not in VALID_TASK_TYPES:
        raise ValueError("invalid_source_bulk_task_type")
    return normalized


def normalize_task_trigger(value: str) -> str:
    normalized = value.strip().lower()
    if normalized not in VALID_TASK_TRIGGERS:
        raise ValueError("invalid_source_bulk_task_trigger")
    return normalized


def normalize_task_options(options: SourceBulkTaskOptions | None, settings: Settings) -> SourceBulkTaskOptions:
    values = dict(options or {})
    scan_limit = max(5, min(int(values.get("scan_limit") or settings.source_scan_batch_size), 200))
    return {
        "wave_size": DEFAULT_WAVE_SIZE,
        "scan_limit": scan_limit,
        "manual_confirm_threshold": DEFAULT_MANUAL_CONFIRM_THRESHOLD,
        "max_downloads_per_source": min(
            MAX_SCHEDULE_DOWNLOADS_PER_SOURCE,
            max(1, int(values.get("max_downloads_per_source") or MAX_SCHEDULE_DOWNLOADS_PER_SOURCE)),
        ),
        "max_downloads_per_task": min(
            MAX_SCHEDULE_DOWNLOADS_PER_TASK,
            max(1, int(values.get("max_downloads_per_task") or MAX_SCHEDULE_DOWNLOADS_PER_TASK)),
        ),
        "confirm_large_download": bool(values.get("confirm_large_download")),
        "scheduled": bool(values.get("scheduled")),
    }


def resolve_source_ids(source_ids: list[int] | None, source_filter: SourceSelectionFilter) -> list[int]:
    if source_ids is not None:
        return normalize_source_ids(source_ids)
    search = to_optional_str(source_filter.get("search"))
    if search and len(search) > 200:
        raise ValueError("source_bulk_task_search_too_long")
    rows = list_sources(
        status=to_optional_str(source_filter.get("status")),
        source_type=to_optional_str(source_filter.get("source_type")),
        deleted=to_optional_str(source_filter.get("deleted")) or "active",
        sort_by=to_optional_str(source_filter.get("sort_by")) or "manual_order",
        sort_direction=to_optional_str(source_filter.get("sort_direction")) or "desc",
        search=search,
        operational_filter=to_optional_str(source_filter.get("operational_filter")),
        limit=MAX_SOURCE_COUNT + 1,
        offset=0,
    )
    if len(rows) > MAX_SOURCE_COUNT:
        raise ValueError("source_bulk_task_too_many_sources")
    raw_excluded = source_filter.get("exclude_source_ids", [])
    if not isinstance(raw_excluded, (list, tuple, set)):
        raise ValueError("invalid_source_bulk_task_exclusions")
    if len(raw_excluded) > MAX_SOURCE_COUNT:
        raise ValueError("source_bulk_task_too_many_exclusions")
    excluded = {int(source_id) for source_id in raw_excluded if int(source_id) > 0}
    return [row.id for row in rows if row.id not in excluded]


def normalize_source_ids(source_ids: list[int]) -> list[int]:
    normalized = list(dict.fromkeys(int(source_id) for source_id in source_ids if int(source_id) > 0))
    if len(normalized) > MAX_SOURCE_COUNT:
        raise ValueError("source_bulk_task_too_many_sources")
    return normalized


def count_missing_downloads(source_ids: list[int]) -> int:
    active_item_exists = (
        select(archive_run_items.c.id)
        .select_from(
            archive_run_items.join(
                archive_runs,
                archive_runs.c.id == archive_run_items.c.archive_run_id,
            )
        )
        .where(
            archive_runs.c.source_id == source_discovered_tweets.c.source_id,
            archive_run_items.c.tweet_id == source_discovered_tweets.c.tweet_id,
            archive_run_items.c.status.in_({"pending", "blocked", "processing"}),
        )
        .correlate(source_discovered_tweets)
        .exists()
    )
    statement = (
        select(func.count(source_discovered_tweets.c.id).label("count"))
        .select_from(
            source_discovered_tweets.join(
                tweets,
                tweets.c.tweet_id == source_discovered_tweets.c.tweet_id,
            )
        )
        .where(
            source_discovered_tweets.c.source_id.in_(source_ids),
            ~active_item_exists,
            or_(
                tweets.c.download_status.is_(None),
                tweets.c.download_status.not_in({"verified", "downloaded", "skipped"}),
            ),
        )
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            return int(cur.fetchone()["count"])


def fetch_task_row(task_id: int) -> SourceBulkTaskRow | None:
    statement = select(source_bulk_tasks).where(source_bulk_tasks.c.id == task_id)
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            row = cur.fetchone()
            return SourceBulkTaskRow.model_validate(dict(row)) if row else None


def fetch_next_active_task() -> SourceBulkTaskRow | None:
    statement = (
        select(source_bulk_tasks)
        .where(source_bulk_tasks.c.status.in_({"queued", "running", "pausing"}))
        .order_by(source_bulk_tasks.c.created_at.asc(), source_bulk_tasks.c.id.asc())
        .limit(1)
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            row = cur.fetchone()
            return SourceBulkTaskRow.model_validate(dict(row)) if row else None


def build_task_payload(task: SourceBulkTaskRow) -> dict[str, object]:
    statement = (
        select(source_bulk_task_items.c.status, func.count(source_bulk_task_items.c.id).label("count"))
        .where(source_bulk_task_items.c.task_id == task.id)
        .group_by(source_bulk_task_items.c.status)
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            counts = {str(row["status"]): int(row["count"]) for row in cur.fetchall()}
    settled = sum(counts.get(status, 0) for status in TERMINAL_ITEM_STATUSES)
    return {
        **dict(task),
        "counts": counts,
        "settled_count": settled,
        "progress": settled / task.total_count if task.total_count else 1.0,
    }


def serialize_task_item(row: dict[str, object]) -> dict[str, object]:
    item_fields = {name: row.get(name) for name in SourceBulkTaskItemRow.model_fields}
    item = SourceBulkTaskItemRow.model_validate(item_fields)
    return {
        **dict(item),
        "label": row.get("label"),
        "author_username": row.get("author_username"),
    }


def start_task(task_id: int) -> None:
    statement = (
        update(source_bulk_tasks)
        .where(source_bulk_tasks.c.id == task_id, source_bulk_tasks.c.status == "queued")
        .values(status="running", started_at=func.now(), updated_at=func.now())
    )
    execute_write(statement)


def set_task_status(task_id: int, status: str) -> None:
    values: dict[str, object] = {"status": status, "updated_at": func.now()}
    if status in {"completed", "completed_with_issues", "cancelled"}:
        values["finished_at"] = func.now()
    execute_write(update(source_bulk_tasks).where(source_bulk_tasks.c.id == task_id).values(**values))


def clear_task_blocking_errors(task_id: int) -> None:
    execute_write(
        update(source_bulk_tasks)
        .where(source_bulk_tasks.c.id == task_id)
        .values(error_category=None, error_message=None, updated_at=func.now())
    )


def requeue_blocked_auth_items(task_id: int) -> None:
    execute_write(
        update(source_bulk_task_items)
        .where(
            source_bulk_task_items.c.task_id == task_id,
            source_bulk_task_items.c.status == "failed",
            source_bulk_task_items.c.error_category.in_(AUTH_BLOCKING_CATEGORIES),
        )
        .values(
            status="queued",
            error_category=None,
            error_message=None,
            finished_at=None,
            updated_at=func.now(),
        )
    )


def pause_task_downloads(task_id: int) -> None:
    for run_id in fetch_task_archive_run_ids(task_id):
        try:
            pause_run(run_id)
        except ValueError:
            continue


def resume_task_downloads(task_id: int) -> None:
    for run_id in fetch_task_archive_run_ids(task_id):
        try:
            resume_run(run_id)
        except ValueError:
            continue


def fetch_task_archive_run_ids(task_id: int) -> list[int]:
    statement = select(source_bulk_task_items.c.archive_run_id).where(
        source_bulk_task_items.c.task_id == task_id,
        source_bulk_task_items.c.status == "downloading",
        source_bulk_task_items.c.archive_run_id.is_not(None),
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            return [int(row["archive_run_id"]) for row in cur.fetchall()]


def block_task(task_id: int, message: str) -> None:
    execute_write(
        update(source_bulk_tasks)
        .where(source_bulk_tasks.c.id == task_id)
        .values(
            status="blocked",
            error_category="auth_required",
            error_message=message,
            updated_at=func.now(),
        )
    )


def cancel_source_bulk_task(task_id: int) -> None:
    item_statement = select(source_bulk_task_items).where(
        source_bulk_task_items.c.task_id == task_id,
        source_bulk_task_items.c.status.in_(ACTIVE_ITEM_STATUSES),
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(item_statement)
            cur.execute(sql, params)
            items = [SourceBulkTaskItemRow.model_validate(dict(row)) for row in cur.fetchall()]
    for item in items:
        if item.status == "scanning":
            try:
                stop_source_scan_session(item.source_id)
            except ValueError:
                pass
            clear_source_task_context(item.source_id, item.id)
        if item.archive_run_id is not None:
            try:
                stop_run(item.archive_run_id)
            except ValueError:
                pass
    execute_write(
        update(source_bulk_task_items)
        .where(
            source_bulk_task_items.c.task_id == task_id,
            source_bulk_task_items.c.status.in_(ACTIVE_ITEM_STATUSES),
        )
        .values(status="cancelled", finished_at=func.now(), updated_at=func.now())
    )
    set_task_status(task_id, "cancelled")


def finalize_scanning_items() -> None:
    statement = (
        select(source_bulk_task_items, archive_sources.c.cursor_state, archive_sources.c.status.label("source_status"))
        .select_from(
            source_bulk_task_items.join(
                archive_sources,
                archive_sources.c.id == source_bulk_task_items.c.source_id,
            )
        )
        .where(source_bulk_task_items.c.status == "scanning")
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            rows = [dict(row) for row in cur.fetchall()]
    for row in rows:
        item = SourceBulkTaskItemRow.model_validate(
            {name: row.get(name) for name in SourceBulkTaskItemRow.model_fields}
        )
        cursor_state = row.get("cursor_state") if isinstance(row.get("cursor_state"), dict) else {}
        scan_summary = fetch_item_scan_summary(item.id)
        if row.get("source_status") == "paused" and scan_summary["error_category"] in AUTH_BLOCKING_CATEGORIES:
            mark_item_failed(
                item.id,
                str(scan_summary["error_category"]),
                str(scan_summary["error_message"] or "来源扫描被认证或限流错误暂停。"),
                scan_summary=scan_summary,
            )
            clear_source_task_context(item.source_id, item.id)
            continue
        if cursor_state.get("automation_enabled"):
            continue
        if cursor_state.get("automation_state") == "stopped":
            mark_item_failed(item.id, "source_scan_stopped", "来源扫描已被停止。", scan_summary=scan_summary)
            clear_source_task_context(item.source_id, item.id)
            continue
        if not scan_summary["scan_run_ids"]:
            category = "source_paused" if row.get("source_status") == "paused" else "source_scan_stopped"
            message = "来源扫描已暂停。" if category == "source_paused" else "来源扫描未开始便被停止。"
            mark_item_failed(item.id, category, message)
            clear_source_task_context(item.source_id, item.id)
            continue
        if scan_summary["error_category"]:
            mark_item_failed(
                item.id,
                str(scan_summary["error_category"]),
                str(scan_summary["error_message"] or "来源刷新未完成。"),
                scan_summary=scan_summary,
            )
            clear_source_task_context(item.source_id, item.id)
            continue
        task = fetch_task_row(item.task_id)
        if task is None:
            continue
        next_status = "waiting_download" if task.task_type == "refresh_and_download_new" else "succeeded"
        values = {
            "status": next_status,
            "scan_run_ids": scan_summary["scan_run_ids"],
            "discovered_count": scan_summary["discovered_count"],
            "new_tweet_count": scan_summary["new_tweet_count"],
            "updated_at": func.now(),
        }
        if next_status == "succeeded":
            values["finished_at"] = func.now()
        execute_write(update(source_bulk_task_items).where(source_bulk_task_items.c.id == item.id).values(**values))
        clear_source_task_context(item.source_id, item.id)


def fetch_item_scan_summary(item_id: int) -> dict[str, object]:
    statement = (
        select(
            func.array_agg(source_scan_runs.c.id).label("scan_run_ids"),
            func.coalesce(func.sum(source_scan_runs.c.discovered_tweet_count), 0).label("discovered_count"),
            func.coalesce(func.sum(source_scan_runs.c.new_tweet_count), 0).label("new_tweet_count"),
        )
        .where(source_scan_runs.c.source_bulk_task_item_id == item_id)
    )
    latest_statement = (
        select(source_scan_runs.c.error_category, source_scan_runs.c.error_message)
        .where(source_scan_runs.c.source_bulk_task_item_id == item_id)
        .order_by(source_scan_runs.c.created_at.desc(), source_scan_runs.c.id.desc())
        .limit(1)
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            row = dict(cur.fetchone())
            sql, params = compile_query(latest_statement)
            cur.execute(sql, params)
            latest = cur.fetchone()
    return {
        "scan_run_ids": list(row.get("scan_run_ids") or []),
        "discovered_count": int(row.get("discovered_count") or 0),
        "new_tweet_count": int(row.get("new_tweet_count") or 0),
        "error_category": latest["error_category"] if latest else None,
        "error_message": latest["error_message"] if latest else None,
    }


def clear_source_task_context(source_id: int, item_id: int) -> None:
    source = get_source(source_id)
    if source is None:
        return
    cursor_state = source.get("cursor_state") if isinstance(source.get("cursor_state"), dict) else {}
    if int(cursor_state.get("bulk_task_item_id") or 0) != item_id:
        return
    cursor_state.pop("bulk_task_item_id", None)
    execute_write(
        update(archive_sources)
        .where(archive_sources.c.id == source_id)
        .values(cursor_state=Jsonb(cursor_state), updated_at=func.now())
    )


def finalize_downloading_items() -> None:
    statement = (
        select(source_bulk_task_items.c.id, source_bulk_task_items.c.task_id, archive_runs.c.status)
        .select_from(
            source_bulk_task_items.join(
                archive_runs,
                archive_runs.c.id == source_bulk_task_items.c.archive_run_id,
            )
        )
        .where(source_bulk_task_items.c.status == "downloading")
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            rows = [dict(row) for row in cur.fetchall()]
    for row in rows:
        run_status = str(row["status"])
        if run_status == "completed":
            mark_item_succeeded(int(row["id"]))
        elif run_status in {"completed_with_failures", "failed", "stopped"}:
            mark_item_failed(
                int(row["id"]),
                "download_incomplete",
                f"下载运行结束状态：{run_status}",
            )


def dispatch_current_wave(task: SourceBulkTaskRow, settings: Settings) -> None:
    queued_wave = fetch_next_dispatchable_wave(task)
    if queued_wave is None:
        dispatch_waiting_downloads(task)
        return
    statement = (
        select(source_bulk_task_items)
        .where(
            source_bulk_task_items.c.task_id == task.id,
            source_bulk_task_items.c.wave_index == queued_wave,
            source_bulk_task_items.c.status == "queued",
        )
        .order_by(source_bulk_task_items.c.position.asc())
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            items = [SourceBulkTaskItemRow.model_validate(dict(row)) for row in cur.fetchall()]
    for item in items:
        dispatch_item(task, item, settings)
    dispatch_waiting_downloads(task)


def fetch_next_dispatchable_wave(task: SourceBulkTaskRow) -> int | None:
    queued_wave_statement = select(func.min(source_bulk_task_items.c.wave_index).label("wave_index")).where(
        source_bulk_task_items.c.task_id == task.id,
        source_bulk_task_items.c.status == "queued",
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(queued_wave_statement)
            cur.execute(sql, params)
            row = cur.fetchone()
            wave = row["wave_index"] if row else None
    if wave is None:
        return None
    # 波次是背压边界：前一波下载没有收敛前，不把后一波继续灌入网络队列。
    blocking_statuses = ACTIVE_ITEM_STATUSES
    blocking_statement = select(func.count(source_bulk_task_items.c.id).label("count")).where(
        source_bulk_task_items.c.task_id == task.id,
        source_bulk_task_items.c.wave_index < int(wave),
        source_bulk_task_items.c.status.in_(blocking_statuses),
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(blocking_statement)
            cur.execute(sql, params)
            blocked = int(cur.fetchone()["count"])
    return None if blocked else int(wave)


def dispatch_item(task: SourceBulkTaskRow, item: SourceBulkTaskItemRow, settings: Settings) -> None:
    source = get_source(item.source_id)
    reason = ineligible_source_reason(task, item, source)
    if reason:
        mark_item_skipped(item.id, reason)
        return
    if task.task_type == "download_missing":
        execute_write(
            update(source_bulk_task_items)
            .where(source_bulk_task_items.c.id == item.id, source_bulk_task_items.c.status == "queued")
            .values(status="waiting_download", started_at=func.now(), updated_at=func.now())
        )
        return
    execute_write(
        update(source_bulk_task_items)
        .where(source_bulk_task_items.c.id == item.id, source_bulk_task_items.c.status == "queued")
        .values(status="scanning", started_at=func.now(), updated_at=func.now())
    )
    try:
        start_source_scan_session(
            item.source_id,
            "latest_refresh",
            limit=int(task.options.get("scan_limit") or settings.source_scan_batch_size),
            restart=True,
            bulk_task_item_id=item.id,
        )
    except ValueError as exc:
        mark_item_failed(item.id, str(exc), str(exc))


def ineligible_source_reason(
    task: SourceBulkTaskRow,
    item: SourceBulkTaskItemRow,
    source: dict[str, object] | None,
) -> str | None:
    if source is None:
        return "source_not_found_or_deleted"
    if source.get("deleted_at"):
        return "source_deleted"
    if task.task_type != "download_missing" and str(source.get("source_type")) not in SCANNABLE_SOURCE_TYPES:
        return "source_scan_not_supported"
    if task.task_type != "download_missing" and str(source.get("status")) == "paused":
        return "source_paused"
    cursor_state = source.get("cursor_state") if isinstance(source.get("cursor_state"), dict) else {}
    current_item_id = int(cursor_state.get("bulk_task_item_id") or 0)
    if cursor_state.get("automation_enabled") and current_item_id != item.id:
        return "source_scan_in_progress"
    statement = select(source_bulk_task_items.c.id).where(
        source_bulk_task_items.c.source_id == item.source_id,
        source_bulk_task_items.c.id != item.id,
        source_bulk_task_items.c.status.in_(ACTIVE_ITEM_STATUSES),
    ).limit(1)
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            if cur.fetchone() is not None:
                return "source_bulk_task_in_progress"
    return None


def dispatch_waiting_downloads(task: SourceBulkTaskRow) -> None:
    statement = (
        select(source_bulk_task_items)
        .where(
            source_bulk_task_items.c.task_id == task.id,
            source_bulk_task_items.c.status == "waiting_download",
        )
        .order_by(source_bulk_task_items.c.position.asc())
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            items = [SourceBulkTaskItemRow.model_validate(dict(row)) for row in cur.fetchall()]
    submitted_total = task_submitted_count(task.id)
    task_limit = int(task.options.get("max_downloads_per_task") or 1000)
    for item in items:
        scheduled = bool(task.options.get("scheduled"))
        remaining = max(0, task_limit - submitted_total) if scheduled else 2**31 - 1
        if scheduled and remaining <= 0:
            mark_item_skipped(item.id, "scheduled_task_download_cap_reached")
            continue
        per_source_limit = int(task.options.get("max_downloads_per_source") or 50)
        limit = min(per_source_limit, remaining) if scheduled else None
        tweet_ids = fetch_item_new_tweet_ids(item) if task.task_type == "refresh_and_download_new" else None
        if task.task_type == "refresh_and_download_new" and not tweet_ids:
            mark_item_succeeded(item.id)
            continue
        try:
            result = submit_source_downloads(
                item.source_id,
                "selected" if tweet_ids is not None else "download_missing",
                tweet_ids=tweet_ids,
                limit=limit,
            )
        except ValueError as exc:
            mark_item_failed(item.id, str(exc), str(exc))
            continue
        submitted = int(result.get("submitted_count") or 0)
        run_id = int(result["run_id"]) if result.get("run_id") is not None else None
        if run_id is None or submitted == 0:
            mark_item_succeeded(item.id, submitted_count=submitted)
        else:
            execute_write(
                update(source_bulk_task_items)
                .where(source_bulk_task_items.c.id == item.id)
                .values(
                    status="downloading",
                    archive_run_id=run_id,
                    submitted_count=submitted,
                    updated_at=func.now(),
                )
            )
        submitted_total += submitted


def fetch_item_new_tweet_ids(item: SourceBulkTaskItemRow) -> list[str]:
    if not item.scan_run_ids:
        summary = fetch_item_scan_summary(item.id)
        scan_run_ids = list(summary["scan_run_ids"])
    else:
        scan_run_ids = item.scan_run_ids
    if not scan_run_ids:
        return []
    statement = (
        select(source_discovered_tweets.c.tweet_id)
        .where(
            source_discovered_tweets.c.source_id == item.source_id,
            source_discovered_tweets.c.first_discovered_scan_run_id.in_(scan_run_ids),
        )
        .order_by(source_discovered_tweets.c.discovered_at.desc(), source_discovered_tweets.c.id.desc())
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            return [str(row["tweet_id"]) for row in cur.fetchall()]


def task_submitted_count(task_id: int) -> int:
    statement = select(func.coalesce(func.sum(source_bulk_task_items.c.submitted_count), 0).label("submitted_count")).where(
        source_bulk_task_items.c.task_id == task_id
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            return int(cur.fetchone()["submitted_count"])


def finalize_task_if_settled(task_id: int) -> None:
    statement = select(
        func.count(source_bulk_task_items.c.id).filter(source_bulk_task_items.c.status.in_(ACTIVE_ITEM_STATUSES)).label(
            "active_count"
        ),
        func.count(source_bulk_task_items.c.id).filter(source_bulk_task_items.c.status == "failed").label(
            "failed_count"
        ),
    ).where(source_bulk_task_items.c.task_id == task_id)
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            row = cur.fetchone()
    if int(row["active_count"]) > 0:
        return
    set_task_status(task_id, "completed_with_issues" if int(row["failed_count"]) else "completed")


def circuit_breaker_triggered(task_id: int) -> bool:
    statement = (
        select(source_bulk_task_items.c.status, source_bulk_task_items.c.error_category)
        .where(
            source_bulk_task_items.c.task_id == task_id,
            source_bulk_task_items.c.finished_at.is_not(None),
        )
        .order_by(source_bulk_task_items.c.finished_at.desc(), source_bulk_task_items.c.id.desc())
        .limit(AUTH_CIRCUIT_BREAKER_THRESHOLD)
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            outcomes = cur.fetchall()
    return len(outcomes) == AUTH_CIRCUIT_BREAKER_THRESHOLD and all(
        row["status"] == "failed" and row["error_category"] in AUTH_BLOCKING_CATEGORIES for row in outcomes
    )


def mark_item_succeeded(item_id: int, *, submitted_count: int | None = None) -> None:
    values: dict[str, object] = {"status": "succeeded", "finished_at": func.now(), "updated_at": func.now()}
    if submitted_count is not None:
        values["submitted_count"] = submitted_count
    execute_write(update(source_bulk_task_items).where(source_bulk_task_items.c.id == item_id).values(**values))


def mark_item_skipped(item_id: int, reason: str) -> None:
    execute_write(
        update(source_bulk_task_items)
        .where(source_bulk_task_items.c.id == item_id)
        .values(
            status="skipped",
            skip_reason=reason,
            finished_at=func.now(),
            updated_at=func.now(),
        )
    )


def mark_item_failed(
    item_id: int,
    category: str,
    message: str,
    *,
    scan_summary: dict[str, object] | None = None,
) -> None:
    values: dict[str, object] = {
        "status": "failed",
        "error_category": category,
        "error_message": message,
        "finished_at": func.now(),
        "updated_at": func.now(),
    }
    if scan_summary:
        values.update(
            {
                "scan_run_ids": scan_summary["scan_run_ids"],
                "discovered_count": scan_summary["discovered_count"],
                "new_tweet_count": scan_summary["new_tweet_count"],
            }
        )
    execute_write(update(source_bulk_task_items).where(source_bulk_task_items.c.id == item_id).values(**values))


def fetch_policy_row(policy_id: int) -> SourceSchedulePolicyRow | None:
    statement = select(source_schedule_policies).where(source_schedule_policies.c.id == policy_id)
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            row = cur.fetchone()
            return SourceSchedulePolicyRow.model_validate(dict(row)) if row else None


def normalize_policy_values(**values: object) -> dict[str, object]:
    label = str(values["label"]).strip()
    action = str(values["action"]).strip().lower()
    frequency_kind = str(values["frequency_kind"]).strip().lower()
    timezone = str(values["timezone"]).strip()
    if not label:
        raise ValueError("source_schedule_policy_label_required")
    if action not in VALID_POLICY_ACTIONS:
        raise ValueError("invalid_source_schedule_policy_action")
    if frequency_kind not in VALID_FREQUENCY_KINDS:
        raise ValueError("invalid_source_schedule_policy_frequency")
    try:
        ZoneInfo(timezone)
    except ZoneInfoNotFoundError as exc:
        raise ValueError("invalid_source_schedule_policy_timezone") from exc
    interval_minutes = to_optional_int(values.get("interval_minutes"))
    local_time = parse_local_time(values.get("local_time"))
    weekday = to_optional_int(values.get("weekday"))
    if frequency_kind == "interval" and (interval_minutes is None or interval_minutes < 60):
        raise ValueError("invalid_source_schedule_policy_interval")
    if frequency_kind in {"daily", "weekly"} and local_time is None:
        raise ValueError("source_schedule_policy_local_time_required")
    if frequency_kind == "weekly" and (weekday is None or weekday < 0 or weekday > 6):
        raise ValueError("invalid_source_schedule_policy_weekday")
    return {
        "label": label,
        "action": action,
        "frequency_kind": frequency_kind,
        "interval_minutes": interval_minutes if frequency_kind == "interval" else None,
        "local_time": local_time if frequency_kind in {"daily", "weekly"} else None,
        "weekday": weekday if frequency_kind == "weekly" else None,
        "timezone": timezone,
        "jitter_seconds": max(0, int(values["jitter_seconds"])),
        "max_downloads_per_source": min(
            MAX_SCHEDULE_DOWNLOADS_PER_SOURCE,
            max(1, int(values["max_downloads_per_source"])),
        ),
        "max_downloads_per_task": min(
            MAX_SCHEDULE_DOWNLOADS_PER_TASK,
            max(1, int(values["max_downloads_per_task"])),
        ),
        "enabled": bool(values["enabled"]),
    }


def calculate_next_policy_run(policy: dict[str, object], now: datetime) -> datetime:
    timezone = ZoneInfo(str(policy["timezone"]))
    local_now = now.astimezone(timezone)
    kind = str(policy["frequency_kind"])
    if kind == "interval":
        interval = timedelta(minutes=int(policy["interval_minutes"]))
        epoch = datetime(1970, 1, 1, tzinfo=UTC)
        elapsed = now - epoch
        steps = int(elapsed.total_seconds() // interval.total_seconds()) + 1
        candidate = epoch + steps * interval
    else:
        local_time = policy["local_time"]
        candidate_local = local_now.replace(
            hour=int(getattr(local_time, "hour")),
            minute=int(getattr(local_time, "minute")),
            second=0,
            microsecond=0,
        )
        if kind == "daily":
            if candidate_local <= local_now:
                candidate_local += timedelta(days=1)
        else:
            target_weekday = int(policy["weekday"])
            days = (target_weekday - local_now.weekday()) % 7
            candidate_local += timedelta(days=days)
            if candidate_local <= local_now:
                candidate_local += timedelta(days=7)
        candidate = candidate_local.astimezone(UTC)
    jitter = random.randint(0, int(policy.get("jitter_seconds") or 0))
    return candidate + timedelta(seconds=jitter)


def parse_local_time(value: object) -> dt_time | None:
    if value is None:
        return None
    if hasattr(value, "hour") and hasattr(value, "minute"):
        return dt_time(hour=int(getattr(value, "hour")), minute=int(getattr(value, "minute")))
    raw = str(value)
    try:
        return datetime.strptime(raw[:5], "%H:%M").time()
    except ValueError as exc:
        raise ValueError("invalid_source_schedule_policy_local_time") from exc


def schedule_has_active_task(policy_id: int) -> bool:
    statement = select(source_bulk_tasks.c.id).where(
        source_bulk_tasks.c.schedule_policy_id == policy_id,
        source_bulk_tasks.c.status.in_(ACTIVE_TASK_STATUSES),
    ).limit(1)
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            return cur.fetchone() is not None


def fetch_policy_source_ids(policy_id: int) -> list[int]:
    statement = (
        select(source_schedule_policy_sources.c.source_id)
        .where(source_schedule_policy_sources.c.policy_id == policy_id)
        .order_by(source_schedule_policy_sources.c.source_id.asc())
        .limit(MAX_SOURCE_COUNT)
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            return [int(row["source_id"]) for row in cur.fetchall()]


def advance_policy_anchor(policy: SourceSchedulePolicyRow) -> None:
    policy_values = dict(policy)
    next_run_at = calculate_next_policy_run(policy_values, datetime.now(UTC))
    execute_write(
        update(source_schedule_policies)
        .where(source_schedule_policies.c.id == policy.id)
        .values(last_run_at=func.now(), next_run_at=next_run_at, updated_at=func.now())
    )


def serialize_policy(row: dict[str, object]) -> dict[str, object]:
    fields = {name: row.get(name) for name in SourceSchedulePolicyRow.model_fields}
    return {**dict(SourceSchedulePolicyRow.model_validate(fields)), "source_count": int(row.get("source_count") or 0)}


def execute_write(statement: Any) -> None:
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
        conn.commit()


def to_optional_str(value: object) -> str | None:
    normalized = str(value).strip() if value is not None else ""
    return normalized or None


def to_optional_int(value: object) -> int | None:
    if value is None or value == "":
        return None
    return int(value)
