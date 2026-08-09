"""来源管理与扫描编排服务。

这个模块负责 source 的增删改查、扫描会话状态、gallery-dl 发现任务，
以及把发现到的推文继续移交给归档下载队列。
"""

from __future__ import annotations

import json
import logging
import random
import re
import shutil
import subprocess
import time
from collections import deque
from pathlib import Path
from queue import Empty, Full, Queue
from threading import Event, Thread
from typing import Any
from urllib.parse import urlparse, urlunparse

from psycopg.errors import UniqueViolation
from psycopg.types.json import Jsonb
from sqlalchemy import (
    Integer,
    and_,
    bindparam,
    case,
    func,
    or_,
    select,
    update,
)
from sqlalchemy.sql import ColumnElement, Select

from xarchiver.config import Settings, get_settings
from xarchiver.core.errors import ErrorCategory, category_value, classify_x_error
from xarchiver.core.events import publish_event
from xarchiver.core.subprocesses import stop_process_group
from xarchiver.db import connect
from xarchiver.downloader import prepare_cookies
from xarchiver.importer import extract_tweet_id, upsert_tweets
from xarchiver.row_models import (
    ArchiveSourceListRow,
    ArchiveSourceRow,
    CursorStateRow,
    IdRow,
    InsertedFlagRow,
    RawPayloadRow,
    SourceDiscoveryRow,
    SourceScanRunRow,
    SourceScanSummaryRow,
    TweetRow,
)
from xarchiver.services.operation_logs import (
    append_operation_log_entries,
    close_operation_log_stream,
    create_operation_log_stream,
    parse_gallery_dl_log_level,
    redact_sensitive_text,
)
from xarchiver.services.queue import (
    count_run_items,
    get_run_detail,
    has_pending_download_work,
    list_runs,
    submit_archive_batch,
)
from xarchiver.sql_builder import compile_query
from xarchiver.tables import (
    archive_run_items,
    archive_runs,
    archive_sources,
    download_jobs,
    source_discovered_tweets,
    source_scan_runs,
    tweets,
)

VALID_SOURCE_TYPES = {"profile", "user_media", "likes", "bookmarks", "search", "manual"}
VALID_SOURCE_STATUSES = {"active", "paused", "completed", "failed"}
VALID_SOURCE_DELETED_FILTERS = {"active", "deleted", "all"}
VALID_SOURCE_SORT_FIELDS = {"manual_order", "updated_at", "created_at"}
VALID_SORT_DIRECTIONS = {"asc", "desc"}
VALID_SCAN_TRIGGERS = {"history_worker", "manual_next", "latest_refresh", "from_start_repair"}
VALID_SCAN_SESSION_MODES = {"history", "latest_refresh", "from_start"}
VALID_DISCOVERY_MEDIA_TYPES = {"video", "photo"}
VALID_DISCOVERY_QUEUE_STATES = {"unsubmitted", "submitted"}
VALID_DISCOVERY_DOWNLOAD_STATES = {"pending", "active", "completed", "failed"}
SOURCE_DELETE_BLOCKING_SCAN_STATUSES = {"running", "waiting_downloads"}
SOURCE_DELETE_BLOCKING_RUN_STATUSES = {"queued", "running", "paused", "blocked"}
SCAN_MODE_TO_TRIGGER = {
    "history": "history_worker",
    "latest_refresh": "latest_refresh",
    "from_start": "from_start_repair",
}
LATEST_REFRESH_DUPLICATE_THRESHOLD = 5
MIN_SOURCE_SCAN_LIMIT = 5
DOWNLOAD_BUSY_SCAN_RETRY_MIN_SECONDS = 60
logger = logging.getLogger(__name__)
LEASE_SECONDS = 60
HEARTBEAT_SECONDS = 20
SOURCE_SCAN_LOG_BATCH_SIZE = 100
SOURCE_SCAN_LOG_FLUSH_SECONDS = 1.0
SOURCE_SCAN_LOG_QUEUE_SIZE = 1000
SOURCE_SCAN_LOG_QUEUE_PUT_TIMEOUT_SECONDS = 0.1
SOURCE_SCAN_PROCESS_STOP_TIMEOUT_SECONDS = 5.0
SOURCE_SCAN_READER_JOIN_TIMEOUT_SECONDS = 5.0
SOURCE_SCAN_READER_DRAIN_TIMEOUT_SECONDS = 10.0
SOURCE_SCAN_STDERR_TAIL_LINES = 2000


class WorkerLeaseLost(RuntimeError):
    """当来源扫描 worker 失去租约所有权时抛出。"""

    pass


class SourceScanLeaseHeartbeat:
    """后台心跳线程，用来维持某个来源扫描运行的租约。"""

    def __init__(self, scan_run_id: int, worker_id: str | None) -> None:
        self.scan_run_id = scan_run_id
        self.worker_id = worker_id
        self.stop = Event()
        self.lost = Event()
        self.thread: Thread | None = None

    def __enter__(self) -> SourceScanLeaseHeartbeat:
        if self.worker_id:
            self.thread = Thread(target=self._run, name="source-scan-lease-heartbeat", daemon=True)
            self.thread.start()
        return self

    def __exit__(self, *_: object) -> None:
        self.stop.set()
        if self.thread:
            self.thread.join(timeout=2)

    def _run(self) -> None:
        while not self.stop.wait(HEARTBEAT_SECONDS):
            if not heartbeat_source_scan_run(self.scan_run_id, self.worker_id or ""):
                self.lost.set()
                return

    def ensure_active(self) -> None:
        if self.lost.is_set():
            raise WorkerLeaseLost("source_scan_lease_lost")


def create_source(
    source_type: str,
    source_url: str,
    label: str | None = None,
    author_username: str | None = None,
) -> dict[str, object]:
    """规范化来源类型和 URL 后，创建新的归档来源。"""

    source_type = normalize_source_type(source_type)
    source_url = normalize_source_url(source_url)
    author_username = author_username or infer_author_username(source_type, source_url)
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select *
                    from archive_sources
                    where source_url = %s
                    limit 1
                    """,
                    (source_url,),
                )
                existing = cur.fetchone()
                if existing and existing["deleted_at"] is None:
                    raise ValueError("source_already_exists")
                if existing:
                    existing_source = ArchiveSourceRow.model_validate(dict(existing))
                    cursor_state = set_active_scan_session_state(
                        existing_source.cursor_state,
                        "stopped",
                        enabled=False,
                    )
                    cur.execute(
                        """
                        update archive_sources
                        set source_type = %s,
                            source_url = %s,
                            label = %s,
                            author_username = %s,
                            status = 'active',
                            is_pinned = false,
                            manual_order = 0,
                            cursor_state = %s,
                            next_scan_at = null,
                            error_category = null,
                            error_message = null,
                            deleted_at = null,
                            updated_at = now()
                        where id = %s
                        returning *
                        """,
                        (
                            source_type,
                            source_url,
                            label,
                            author_username,
                            Jsonb(cursor_state),
                            existing_source.id,
                        ),
                    )
                    event_type = "source.restored"
                else:
                    cur.execute(
                        """
                        insert into archive_sources (source_type, source_url, label, author_username)
                        values (%s, %s, %s, %s)
                        returning *
                        """,
                        (source_type, source_url, label, author_username),
                    )
                    event_type = "source.created"
                row = dict(ArchiveSourceRow.model_validate(dict(cur.fetchone())))
            conn.commit()
    except UniqueViolation as exc:
        raise ValueError("source_already_exists") from exc
    publish_event(
        "sources",
        event_type,
        {"source_id": int(row["id"]), "source_type": source_type, "source_url": source_url},
    )
    return row


def list_sources(
    status: str | None = None,
    source_type: str | None = None,
    deleted: str = "active",
    sort_by: str = "manual_order",
    sort_direction: str = "desc",
    limit: int = 50,
    offset: int = 0,
) -> list[ArchiveSourceListRow]:
    """列出来源，并附带发现量和扫描量聚合统计。"""

    sql, params = build_sources_query(
        status=status,
        source_type=source_type,
        deleted=deleted,
        sort_by=sort_by,
        sort_direction=sort_direction,
        limit=limit,
        offset=offset,
    )
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [ArchiveSourceListRow.model_validate(dict(row)) for row in cur.fetchall()]


def list_sources_page(
    status: str | None = None,
    source_type: str | None = None,
    deleted: str = "active",
    sort_by: str = "manual_order",
    sort_direction: str = "desc",
    limit: int = 50,
    offset: int = 0,
) -> dict[str, object]:
    """返回带总数信息的来源分页结果。"""

    rows = list_sources(
        status=status,
        source_type=source_type,
        deleted=deleted,
        sort_by=sort_by,
        sort_direction=sort_direction,
        limit=limit,
        offset=offset,
    )
    total_count = count_sources(status=status, source_type=source_type, deleted=deleted)
    return {
        "rows": [dict(row) for row in rows],
        "count": len(rows),
        "total_count": total_count,
        "limit": limit,
        "offset": offset,
    }


def count_sources(
    status: str | None = None,
    source_type: str | None = None,
    deleted: str = "active",
) -> int:
    """按与 ``list_sources`` 相同的过滤条件统计来源数量。"""

    sql, params = build_count_sources_query(status=status, source_type=source_type, deleted=deleted)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return int(cur.fetchone()["count"])


def build_sources_query(
    status: str | None = None,
    source_type: str | None = None,
    deleted: str = "active",
    sort_by: str = "manual_order",
    sort_direction: str = "desc",
    limit: int = 50,
    offset: int = 0,
) -> tuple[str, dict[str, object]]:
    """构造带聚合列的来源分页查询。"""

    discovery_count = func.count(source_discovered_tweets.c.id).cast(Integer)
    unsubmitted_count = (
        func.count(source_discovered_tweets.c.id)
        .filter(source_discovered_tweets.c.archive_run_id.is_(None))
        .cast(Integer)
    )
    media_count = func.coalesce(
        func.sum(
            func.coalesce(
                source_discovered_tweets.c.raw_payload["media_count"].astext.cast(Integer),
                0,
            )
        ),
        0,
    ).cast(Integer)
    scan_batch_count = (
        select(func.count(source_scan_runs.c.id).cast(Integer))
        .where(
            and_(
                source_scan_runs.c.source_id == archive_sources.c.id,
                source_scan_runs.c.status != "waiting_downloads",
            )
        )
        .scalar_subquery()
    )

    normalized_sort_field = normalize_source_sort_field(sort_by)
    normalized_direction = normalize_sort_direction(sort_direction)
    if normalized_sort_field == "manual_order":
        sort_expressions = [
            case((archive_sources.c.manual_order > 0, 0), else_=1).asc(),
            archive_sources.c.manual_order.asc(),
            archive_sources.c.created_at.desc(),
            archive_sources.c.id.desc(),
        ]
    else:
        sort_column = archive_sources.c[normalized_sort_field]
        sort_expression = sort_column.asc() if normalized_direction == "asc" else sort_column.desc()
        id_expression = archive_sources.c.id.asc() if normalized_direction == "asc" else archive_sources.c.id.desc()
        sort_expressions = [sort_expression, id_expression]

    statement = (
        select(
            archive_sources,
            discovery_count.label("discovered_tweet_count"),
            unsubmitted_count.label("unsubmitted_tweet_count"),
            media_count.label("discovered_media_count"),
            scan_batch_count.label("scan_batch_count"),
            func.max(source_discovered_tweets.c.discovered_at).label("latest_discovered_at"),
        )
        .select_from(
            archive_sources.outerjoin(
                source_discovered_tweets,
                source_discovered_tweets.c.source_id == archive_sources.c.id,
            )
        )
        .group_by(archive_sources.c.id)
        .order_by(archive_sources.c.is_pinned.desc(), *sort_expressions)
        .limit(bindparam("limit", limit))
        .offset(bindparam("offset", offset))
    )
    statement = apply_source_filters(statement, status=status, source_type=source_type, deleted=deleted)
    return compile_query(statement)


def build_count_sources_query(
    status: str | None = None,
    source_type: str | None = None,
    deleted: str = "active",
) -> tuple[str, dict[str, object]]:
    """构造与 ``build_sources_query`` 对应的数量查询。"""

    statement = select(func.count().cast(Integer).label("count")).select_from(archive_sources)
    statement = apply_source_filters(statement, status=status, source_type=source_type, deleted=deleted)
    return compile_query(statement)


def apply_source_filters(
    statement: Select,
    status: str | None = None,
    source_type: str | None = None,
    deleted: str = "active",
) -> Select:
    """把可选来源过滤条件应用到 SQLAlchemy 语句上。"""

    filters = build_source_filters(status=status, source_type=source_type, deleted=deleted)
    if not filters:
        return statement
    return statement.where(and_(*filters))


def build_source_filters(
    status: str | None = None,
    source_type: str | None = None,
    deleted: str = "active",
) -> list[ColumnElement[bool]]:
    """构造可复用的来源过滤表达式。"""

    normalized_deleted = normalize_source_deleted_filter(deleted)
    filters: list[ColumnElement[bool]] = []
    if normalized_deleted == "active":
        filters.append(archive_sources.c.deleted_at.is_(None))
    elif normalized_deleted == "deleted":
        filters.append(archive_sources.c.deleted_at.is_not(None))
    if status:
        filters.append(
            archive_sources.c.status == bindparam(
                "source_status",
                normalize_source_status(status),
            )
        )
    if source_type:
        filters.append(
            archive_sources.c.source_type == bindparam(
                "source_type",
                normalize_source_type(source_type),
            )
        )
    return filters


def normalize_source_deleted_filter(value: str) -> str:
    """校验来源软删除筛选范围。"""

    normalized = value.strip().lower()
    if normalized not in VALID_SOURCE_DELETED_FILTERS:
        raise ValueError("invalid_source_deleted_filter")
    return normalized


def normalize_source_sort_field(value: str) -> str:
    """校验允许使用的来源排序字段。"""

    if value not in VALID_SOURCE_SORT_FIELDS:
        raise ValueError("invalid_source_sort_field")
    return value


def normalize_sort_direction(value: str) -> str:
    """校验允许使用的排序方向。"""

    if value not in VALID_SORT_DIRECTIONS:
        raise ValueError("invalid_sort_direction")
    return value


def update_source_pin(source_id: int, is_pinned: bool) -> dict[str, object]:
    """切换来源的置顶标记，供列表排序使用。"""

    statement = (
        update(archive_sources)
        .where(
            archive_sources.c.id == bindparam("source_id"),
            archive_sources.c.deleted_at.is_(None),
        )
        .values(is_pinned=bindparam("is_pinned"), manual_order=0)
        .returning(archive_sources)
    )
    sql, params = compile_query(statement)
    params.update({"source_id": source_id, "is_pinned": is_pinned})
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            result = cur.fetchone()
            if result is None:
                raise ValueError("source_not_found")
            ArchiveSourceRow.model_validate(dict(result))
        conn.commit()
    publish_event("sources", "source.pin_changed", {"source_id": source_id, "is_pinned": is_pinned})
    return get_source(source_id) or dict(result)


def reorder_sources(source_ids: list[int]) -> dict[str, object]:
    """Persist the manual order for one active pinned or unpinned source partition."""

    deduped_source_ids = list(dict.fromkeys(source_ids))
    if len(deduped_source_ids) < 2:
        raise ValueError("source_reorder_too_few_sources")
    if len(deduped_source_ids) > 200:
        raise ValueError("source_reorder_too_many_sources")

    requested_ids = {int(source_id) for source_id in deduped_source_ids}
    with connect() as conn:
        with conn.cursor() as cur:
            select_requested = (
                select(
                    archive_sources.c.id,
                    archive_sources.c.is_pinned,
                )
                .where(archive_sources.c.id.in_(requested_ids))
                .where(archive_sources.c.deleted_at.is_(None))
                .with_for_update()
            )
            sql, params = compile_query(select_requested)
            cur.execute(sql, params)
            requested_rows = [dict(row) for row in cur.fetchall()]
            if len(requested_rows) != len(requested_ids):
                raise ValueError("source_reorder_invalid_source")

            pinned_values = {bool(row["is_pinned"]) for row in requested_rows}
            if len(pinned_values) != 1:
                raise ValueError("source_reorder_cross_pinned_partition")
            is_pinned = pinned_values.pop()

            partition_order = (
                select(archive_sources.c.id)
                .where(
                    archive_sources.c.deleted_at.is_(None),
                    archive_sources.c.is_pinned.is_(is_pinned),
                )
                .order_by(
                    case((archive_sources.c.manual_order > 0, 0), else_=1).asc(),
                    archive_sources.c.manual_order.asc(),
                    archive_sources.c.created_at.desc(),
                    archive_sources.c.id.desc(),
                )
                .with_for_update()
            )
            sql, params = compile_query(partition_order)
            cur.execute(sql, params)
            existing_ids = [int(row["id"]) for row in cur.fetchall()]

            final_ids = deduped_source_ids + [source_id for source_id in existing_ids if source_id not in requested_ids]
            order_by_id = {source_id: index + 1 for index, source_id in enumerate(final_ids)}
            update_statement = (
                update(archive_sources)
                .where(archive_sources.c.id.in_(order_by_id.keys()))
                .values(manual_order=case(order_by_id, value=archive_sources.c.id))
            )
            sql, params = compile_query(update_statement)
            cur.execute(sql, params)
        conn.commit()

    publish_event("sources", "source.reordered", {"source_ids": deduped_source_ids, "is_pinned": is_pinned})
    return {"source_ids": deduped_source_ids, "is_pinned": is_pinned, "updated_count": len(final_ids)}


def delete_source(source_id: int, confirm_delete: bool = False) -> dict[str, object]:
    """软删除来源配置，保留已发现、扫描和下载历史。"""

    if not confirm_delete:
        raise ValueError("source_delete_confirmation_required")
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select *
                from archive_sources
                where id = %s
                  and deleted_at is null
                for update
                """,
                (source_id,),
            )
            row = cur.fetchone()
            if row is None:
                raise ValueError("source_not_found")
            source = ArchiveSourceRow.model_validate(dict(row))
            cur.execute(
                """
                select id
                from source_scan_runs
                where source_id = %s
                  and status = any(%s)
                limit 1
                """,
                (source_id, list(SOURCE_DELETE_BLOCKING_SCAN_STATUSES)),
            )
            if cur.fetchone() is not None:
                raise ValueError("source_delete_active_work")
            cur.execute(
                """
                select id
                from archive_runs
                where source_id = %s
                  and status = any(%s)
                limit 1
                """,
                (source_id, list(SOURCE_DELETE_BLOCKING_RUN_STATUSES)),
            )
            if cur.fetchone() is not None:
                raise ValueError("source_delete_active_work")
            cur.execute(
                """
                select i.id
                from archive_run_items i
                join archive_runs r on r.id = i.archive_run_id
                where r.source_id = %s
                  and i.status = 'processing'
                limit 1
                """,
                (source_id,),
            )
            if cur.fetchone() is not None:
                raise ValueError("source_delete_active_work")
            cursor_state = set_active_scan_session_state(
                source.cursor_state,
                "stopped",
                enabled=False,
            )
            cur.execute(
                """
                update archive_sources
                set status = 'paused',
                    is_pinned = false,
                    cursor_state = %s,
                    next_scan_at = null,
                    deleted_at = now(),
                    updated_at = now()
                where id = %s
                  and deleted_at is null
                returning id, deleted_at
                """,
                (Jsonb(cursor_state), source_id),
            )
            deleted = cur.fetchone()
            if deleted is None:
                raise ValueError("source_not_found")
            result = {"source_id": int(deleted["id"]), "deleted_at": deleted["deleted_at"]}
        conn.commit()
    publish_event("sources", "source.deleted", {"source_id": source_id, "deleted_at": result["deleted_at"].isoformat()})
    return result


def get_source(source_id: int, include_deleted: bool = False) -> dict[str, object] | None:
    """读取单个来源，并附带发现聚合和当前扫描元数据。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select s.*,
                       count(d.id)::int as discovered_tweet_count,
                       count(d.id) filter (where d.archive_run_id is null)::int as unsubmitted_tweet_count,
                       coalesce(sum(coalesce((d.raw_payload->>'media_count')::int, 0)), 0)::int as discovered_media_count,
                       (
                         select count(*)::int
                         from source_scan_runs r
                         where r.source_id = s.id
                           and r.status <> 'waiting_downloads'
                       ) as scan_batch_count,
                       max(d.discovered_at) as latest_discovered_at
                from archive_sources s
                left join source_discovered_tweets d on d.source_id = s.id
                where s.id = %s
                  and (%s or s.deleted_at is null)
                group by s.id
                """,
                (source_id, include_deleted),
            )
            source = cur.fetchone()
            if source is None:
                return None
            source_row = ArchiveSourceListRow.model_validate(dict(source))
            cur.execute(
                """
                select (count(*) filter (where status <> 'waiting_downloads'))::int as batch_count,
                       coalesce(sum(new_tweet_count), 0)::int as added_tweet_count,
                       max(finished_at) filter (
                         where status in ('succeeded', 'completed_empty_batch', 'completed_end_of_source')
                       ) as last_success_at,
                       max(finished_at) filter (
                         where status in ('rate_limited', 'auth_required', 'network_error', 'failed')
                       ) as last_error_at
                from source_scan_runs
                where source_id = %s
                """,
                (source_id,),
            )
            scan_summary = dict(SourceScanSummaryRow.model_validate(dict(cur.fetchone())))
            cur.execute(
                """
                select r.id, r.trigger_type, r.status, r.range_start, r.range_end, r.requested_limit,
                       cursor_before, cursor_after, discovered_tweet_count, new_tweet_count,
                       duplicate_tweet_count, discovered_media_count, error_category,
                       error_message, progress_message, log_stream_id, l.log_path, r.last_log_at,
                       started_at, finished_at, r.created_at
                from source_scan_runs r
                left join operation_log_streams l on l.id = r.log_stream_id
                where r.source_id = %s
                  and r.status = 'running'
                order by r.created_at desc, r.id desc
                limit 1
                """,
                (source_id,),
            )
            active_scan = cur.fetchone()
    return {
        **dict(source_row),
        "scan_summary": scan_summary,
        "active_scan_run": dict(SourceScanRunRow.model_validate(dict(active_scan))) if active_scan else None,
    }


DISCOVERY_ACTIVE_SQL = "a.active_item_status in ('pending','blocked','processing')"
DISCOVERY_COMPLETED_SQL = "t.download_status in ('verified','downloaded','skipped')"
DISCOVERY_FAILED_SQL = (
    "t.download_status in ('failed_retryable','failed_permanent','corrupt') "
    "or a.active_item_status = 'failed_retryable'"
)
DISCOVERY_PENDING_SQL = (
    f"not coalesce(({DISCOVERY_ACTIVE_SQL}), false) "
    f"and not coalesce(({DISCOVERY_COMPLETED_SQL}), false) "
    f"and not coalesce(({DISCOVERY_FAILED_SQL}), false)"
)
DISCOVERY_MISSING_SQL = (
    f"not coalesce(({DISCOVERY_ACTIVE_SQL}), false) "
    f"and not coalesce(({DISCOVERY_COMPLETED_SQL}), false)"
)


def normalize_discovery_media_type(value: str | None) -> str | None:
    """校验发现列表与下载提交使用的媒体类型筛选。"""

    if value is None or value == "":
        return None
    normalized = value.strip().lower()
    if normalized not in VALID_DISCOVERY_MEDIA_TYPES:
        raise ValueError("invalid_media_type")
    return normalized


def normalize_discovery_queue_state(value: str | None) -> str | None:
    """校验发现列表入队状态筛选。"""

    if value is None or value == "":
        return None
    normalized = value.strip().lower()
    if normalized not in VALID_DISCOVERY_QUEUE_STATES:
        raise ValueError("invalid_queue_state")
    return normalized


def normalize_discovery_download_state(value: str | None) -> str | None:
    """校验发现列表下载状态筛选。"""

    if value is None or value == "":
        return None
    normalized = value.strip().lower()
    if normalized not in VALID_DISCOVERY_DOWNLOAD_STATES:
        raise ValueError("invalid_download_state")
    return normalized


def build_discovery_filter_clauses(
    media_type: str | None,
    queue_state: str | None,
    download_state: str | None,
) -> tuple[list[str], list[object]]:
    """构造发现列表、数量查询和分面复用的参数化筛选条件。"""

    clauses: list[str] = []
    params: list[object] = []
    normalized_media_type = normalize_discovery_media_type(media_type)
    normalized_queue_state = normalize_discovery_queue_state(queue_state)
    normalized_download_state = normalize_discovery_download_state(download_state)
    if normalized_media_type:
        clauses.append("d.raw_payload->'media_types' ? %s")
        params.append(normalized_media_type)
    if normalized_queue_state == "unsubmitted":
        clauses.append("d.archive_run_id is null")
    elif normalized_queue_state == "submitted":
        clauses.append("d.archive_run_id is not null")
    if normalized_download_state == "active":
        clauses.append(f"({DISCOVERY_ACTIVE_SQL})")
    elif normalized_download_state == "completed":
        clauses.append(f"({DISCOVERY_COMPLETED_SQL})")
    elif normalized_download_state == "failed":
        clauses.append(f"({DISCOVERY_FAILED_SQL})")
    elif normalized_download_state == "pending":
        clauses.append(DISCOVERY_PENDING_SQL)
    return clauses, params


def list_source_discovered_page(
    source_id: int,
    limit: int = 50,
    offset: int = 0,
    include_deleted: bool = False,
    media_type: str | None = None,
    queue_state: str | None = None,
    download_state: str | None = None,
) -> dict[str, object]:
    """返回某个来源已发现的推文，并补上队列进度信息。"""

    filter_clauses, filter_params = build_discovery_filter_clauses(media_type, queue_state, download_state)
    where_sql = " and ".join(["d.source_id = %s", *filter_clauses])
    query_params: list[object] = [source_id, *filter_params, limit, offset]
    count_params: list[object] = [source_id, *filter_params]
    active_items_cte = """
                with active_items as (
                  select distinct on (i.tweet_id)
                         i.tweet_id,
                         i.id as active_item_id,
                         i.archive_run_id as active_run_id,
                         i.status as active_item_status,
                         r.status as active_run_status,
                         i.cancel_requested,
                         i.downloaded_bytes,
                         i.total_bytes,
                         i.speed_bps,
                         i.progress_message,
                         i.last_progress_at
                  from archive_run_items i
                  join archive_runs r on r.id = i.archive_run_id
                  where i.status in ('pending', 'blocked', 'processing', 'failed_retryable')
                  order by i.tweet_id, i.id desc
                )
                """
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select 1 from archive_sources where id = %s and (%s or deleted_at is null)",
                (source_id, include_deleted),
            )
            if cur.fetchone() is None:
                raise ValueError("source_not_found")
            # This endpoint predates the SQLAlchemy Core migration and already uses fixed SQL with
            # several CTEs; keep the local fixed SQL shape while appending parameterized filters.
            cur.execute(
                f"""
                {active_items_cte},
                media_summary as (
                  select tweet_id,
                         count(*) filter (where download_status in ('downloaded', 'verified'))::int as downloaded_media_count,
                         coalesce(sum(file_size) filter (where download_status in ('downloaded', 'verified')), 0)::bigint as downloaded_media_bytes
                  from media_assets
                  group by tweet_id
                )
                select d.id, d.tweet_id, d.archive_run_id, d.discovered_at, t.download_status,
                       t.author_username, t.text, d.raw_payload,
                       a.active_run_id, a.active_item_id, a.active_item_status, a.active_run_status,
                       a.cancel_requested, a.downloaded_bytes, a.total_bytes, a.speed_bps,
                       a.progress_message, a.last_progress_at,
                       coalesce(m.downloaded_media_count, 0)::int as downloaded_media_count,
                       coalesce(m.downloaded_media_bytes, 0)::bigint as downloaded_media_bytes
                from source_discovered_tweets d
                join tweets t on t.tweet_id = d.tweet_id
                left join active_items a on a.tweet_id = d.tweet_id
                left join media_summary m on m.tweet_id = d.tweet_id
                where {where_sql}
                order by d.discovered_at desc, d.id desc
                limit %s offset %s
                """,
                tuple(query_params),
            )
            rows = [dict(SourceDiscoveryRow.model_validate(dict(row))) for row in cur.fetchall()]
            cur.execute(
                f"""
                {active_items_cte}
                select count(*)::int as count
                from source_discovered_tweets d
                join tweets t on t.tweet_id = d.tweet_id
                left join active_items a on a.tweet_id = d.tweet_id
                where {where_sql}
                """,
                tuple(count_params),
            )
            total_count = int(cur.fetchone()["count"])
            cur.execute(
                f"""
                {active_items_cte}
                select
                  count(*) filter (where d.archive_run_id is null)::int as all_unsubmitted_count,
                  count(*) filter (where {DISCOVERY_MISSING_SQL})::int as missing_count,
                  count(*) filter (where {DISCOVERY_FAILED_SQL})::int as failed_count
                from source_discovered_tweets d
                join tweets t on t.tweet_id = d.tweet_id
                left join active_items a on a.tweet_id = d.tweet_id
                where {where_sql}
                """,
                tuple(count_params),
            )
            action_count_row = cur.fetchone()
            action_counts = {
                "all_unsubmitted": int(action_count_row["all_unsubmitted_count"]),
                "missing": int(action_count_row["missing_count"]),
                "failed": int(action_count_row["failed_count"]),
            }
            cur.execute(
                "select count(*)::int as count from source_discovered_tweets where source_id = %s",
                (source_id,),
            )
            unfiltered_total_count = int(cur.fetchone()["count"])
            facets = None
            if offset == 0:
                cur.execute(
                    f"""
                    {active_items_cte}
                    select
                      count(*)::int as all_count,
                      count(*) filter (where d.raw_payload->'media_types' ? 'video')::int as video_count,
                      count(*) filter (where d.raw_payload->'media_types' ? 'photo')::int as photo_count,
                      count(*) filter (where d.archive_run_id is null)::int as unsubmitted_count,
                      count(*) filter (where d.archive_run_id is not null)::int as submitted_count,
                      count(*) filter (where {DISCOVERY_ACTIVE_SQL})::int as active_count,
                      count(*) filter (where {DISCOVERY_COMPLETED_SQL})::int as completed_count,
                      count(*) filter (where {DISCOVERY_FAILED_SQL})::int as failed_count,
                      count(*) filter (where {DISCOVERY_PENDING_SQL})::int as pending_count
                    from source_discovered_tweets d
                    join tweets t on t.tweet_id = d.tweet_id
                    left join active_items a on a.tweet_id = d.tweet_id
                    where d.source_id = %s
                    """,
                    (source_id,),
                )
                facet_row = cur.fetchone()
                facets = {
                    "media": {
                        "all": int(facet_row["all_count"]),
                        "video": int(facet_row["video_count"]),
                        "photo": int(facet_row["photo_count"]),
                    },
                    "queue": {
                        "unsubmitted": int(facet_row["unsubmitted_count"]),
                        "submitted": int(facet_row["submitted_count"]),
                    },
                    "download": {
                        "pending": int(facet_row["pending_count"]),
                        "active": int(facet_row["active_count"]),
                        "completed": int(facet_row["completed_count"]),
                        "failed": int(facet_row["failed_count"]),
                    },
                }
    return {
        "rows": rows,
        "count": len(rows),
        "total_count": total_count,
        "unfiltered_total_count": unfiltered_total_count,
        "action_counts": action_counts,
        "facets": facets,
        "limit": limit,
        "offset": offset,
    }


def list_source_scan_runs_page(
    source_id: int,
    limit: int = 20,
    offset: int = 0,
    include_deleted: bool = False,
) -> dict[str, object]:
    """返回某个来源的扫描运行历史。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select 1 from archive_sources where id = %s and (%s or deleted_at is null)",
                (source_id, include_deleted),
            )
            if cur.fetchone() is None:
                raise ValueError("source_not_found")
            cur.execute(
                """
                select r.id, r.trigger_type, r.status, r.range_start, r.range_end, r.requested_limit,
                       cursor_before, cursor_after, discovered_tweet_count, new_tweet_count,
                       duplicate_tweet_count, discovered_media_count, error_category,
                       error_message, progress_message, log_stream_id, l.log_path, r.last_log_at,
                       started_at, finished_at, r.created_at
                from source_scan_runs r
                left join operation_log_streams l on l.id = r.log_stream_id
                where r.source_id = %s
                order by r.created_at desc, r.id desc
                limit %s offset %s
                """,
                (source_id, limit, offset),
            )
            rows = [dict(SourceScanRunRow.model_validate(dict(row))) for row in cur.fetchall()]
            cur.execute(
                "select count(*)::int as count from source_scan_runs where source_id = %s",
                (source_id,),
            )
            total_count = int(cur.fetchone()["count"])
    return {
        "rows": rows,
        "count": len(rows),
        "total_count": total_count,
        "limit": limit,
        "offset": offset,
    }


def update_source_status(source_id: int, status: str) -> dict[str, object]:
    """更新来源状态，并同步维护扫描会话状态。"""

    status = normalize_source_status(status)
    source = get_source(source_id)
    if source is None:
        raise ValueError("source_not_found")
    cursor_state = source.get("cursor_state") if isinstance(source.get("cursor_state"), dict) else {}
    active_scan_run = source.get("active_scan_run")
    running_scan_run = (
        active_scan_run
        if isinstance(active_scan_run, dict)
        and active_scan_run.get("status") == "running"
        and active_scan_run.get("log_stream_id")
        else None
    )
    automation_enabled = bool(cursor_state.get("automation_enabled"))
    if automation_enabled and not cursor_state.get("active_scan_mode"):
        cursor_state = ensure_legacy_active_scan_session(cursor_state)
    if automation_enabled and status == "paused":
        cursor_state = set_active_scan_session_state(cursor_state, "paused")
    elif automation_enabled and status == "active":
        cursor_state = set_active_scan_session_state(cursor_state, "running")
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update archive_sources
                set status = %s,
                    cursor_state = %s,
                    next_scan_at = case when %s then now() else null end,
                    updated_at = now()
                where id = %s
                returning *
                """,
                (status, Jsonb(cursor_state), automation_enabled and status == "active", source_id),
            )
            row = ArchiveSourceRow.model_validate(dict(cur.fetchone()))
        conn.commit()
    publish_event("sources", "source.status_changed", {"source_id": source_id, "status": status})
    if status == "paused" and running_scan_run:
        append_source_scan_log(
            int(running_scan_run["id"]),
            "warning",
            "source-scan",
            "来源已暂停。当前 gallery-dl 批次会自然结束，但不会再调度下一批。",
        )
    return get_source(source_id) or dict(row)


def start_source_history_scan(source_id: int, limit: int = 20, restart: bool = False) -> dict[str, object]:
    """兼容旧入口：启动一次 history 扫描会话。"""

    return start_source_scan_session(source_id, "history", limit=limit, restart=restart)


def start_source_scan_session(
    source_id: int,
    mode: str,
    limit: int = 20,
    restart: bool = False,
) -> dict[str, object]:
    """为来源启动或重启一个自动扫描会话。"""

    mode = normalize_scan_session_mode(mode)
    limit = normalize_scan_limit(limit)
    source = get_source(source_id)
    if source is None:
        raise ValueError("source_not_found")
    if str(source.get("source_type")) not in {"profile", "user_media", "likes"}:
        raise ValueError("source_scan_not_supported")
    cursor_state = source.get("cursor_state") if isinstance(source.get("cursor_state"), dict) else {}
    if cursor_state.get("automation_enabled") and cursor_state.get("active_scan_mode") not in {None, mode}:
        raise ValueError("source_scan_session_in_progress")
    cursor_state = start_scan_session_state(cursor_state, mode, limit, restart=restart)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update archive_sources
                set status = 'active',
                    cursor_state = %s,
                    next_scan_at = now(),
                    error_category = null,
                    error_message = null,
                    updated_at = now()
                where id = %s
                """,
                (Jsonb(cursor_state), source_id),
            )
        conn.commit()
    publish_event(
        "source_scans",
        "source.scan_session.started",
        {"source_id": source_id, "mode": mode, "limit": limit, "restart": restart},
    )
    return get_source(source_id) or {}


def stop_source_history_scan(source_id: int) -> dict[str, object]:
    """兼容旧入口：停止一次 history 扫描会话。"""

    return stop_source_scan_session(source_id)


def pause_source_scan_session(source_id: int) -> dict[str, object]:
    """暂停来源当前活跃的扫描会话。"""

    return update_source_status(source_id, "paused")


def resume_source_scan_session(source_id: int) -> dict[str, object]:
    """恢复来源已暂停的扫描会话。"""

    source = get_source(source_id)
    if source is None:
        raise ValueError("source_not_found")
    cursor_state = source.get("cursor_state") if isinstance(source.get("cursor_state"), dict) else {}
    if not cursor_state.get("active_scan_mode"):
        raise ValueError("source_scan_session_not_found")
    return update_source_status(source_id, "active")


def stop_source_scan_session(source_id: int) -> dict[str, object]:
    """停止当前扫描会话，并清除下次调度时间。"""

    source = get_source(source_id)
    if source is None:
        raise ValueError("source_not_found")
    cursor_state = source.get("cursor_state") if isinstance(source.get("cursor_state"), dict) else {}
    cursor_state = set_active_scan_session_state(cursor_state, "stopped", enabled=False)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update archive_sources
                set status = case when status = 'paused' then 'active' else status end,
                    cursor_state = %s,
                    next_scan_at = null,
                    updated_at = now()
                where id = %s
                """,
                (Jsonb(cursor_state), source_id),
            )
        conn.commit()
    publish_event("source_scans", "source.scan_session.stopped", {"source_id": source_id})
    return get_source(source_id) or {}


def process_next_source_history_scan(settings: Settings, worker_id: str | None = None) -> dict[str, object] | None:
    """挑选下一个到期来源，并执行一批自动扫描。"""

    source = fetch_due_history_source()
    if source is None:
        return None
    source_id = int(source["id"])
    cursor_state = source.get("cursor_state") if isinstance(source.get("cursor_state"), dict) else {}
    mode = normalize_scan_session_mode(str(cursor_state.get("active_scan_mode") or "history"))
    trigger_type = SCAN_MODE_TO_TRIGGER[mode]
    session = get_scan_session(cursor_state, mode)
    limit = normalize_scan_limit(parse_positive_int(session.get("limit") or cursor_state.get("automation_limit"), settings.source_scan_batch_size))
    try:
        downloads_pending = has_pending_download_work()
    except Exception as exc:
        record_source_scan_failure(source_id, cursor_state, limit, trigger_type, exc)
        schedule_next_history_scan(source_id, settings, "retry_wait")
        raise
    if downloads_pending:
        # 来源扫描要给下载队列让路，避免发现速度长期快于媒体处理速度。
        record_waiting_downloads_scan(source_id, cursor_state, limit, trigger_type=trigger_type)
        schedule_next_history_scan(
            source_id,
            settings,
            "waiting_downloads",
            min_delay_seconds=DOWNLOAD_BUSY_SCAN_RETRY_MIN_SECONDS,
        )
        return {"source_id": source_id, "deferred": "download_queue_active"}
    try:
        result = scan_source(
            source_id,
            limit,
            settings=settings,
            trigger_type=trigger_type,
            session_mode=mode,
            worker_id=worker_id,
        )
    except WorkerLeaseLost:
        raise
    except ValueError as exc:
        if str(exc) == "source_scan_in_progress":
            return None
        schedule_next_history_scan(source_id, settings, "retry_wait")
        raise
    except Exception:
        schedule_next_history_scan(source_id, settings, "retry_wait")
        raise
    error_category = result.get("scanner", {}).get("error_category") if isinstance(result.get("scanner"), dict) else None
    if error_category in {"rate_limited", "auth_required"}:
        pause_history_scan_for_error(source_id, str(error_category))
    elif result.get("completed"):
        finish_history_scan(source_id)
    else:
        schedule_next_history_scan(source_id, settings, "running" if not error_category else "retry_wait")
    return result


def recover_interrupted_source_scan_runs() -> int:
    """API 重启后，把仍处于 running 的扫描运行标记为失败。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update source_scan_runs
                set status = 'failed',
                    error_category = 'interrupted',
                    error_message = 'API 在当前扫描批次结束前已停止。',
                    finished_at = now()
                where status = 'running'
                """
            )
            recovered = cur.rowcount
        conn.commit()
    return recovered


def recover_expired_source_scan_leases() -> int:
    """把 worker 租约过期的扫描运行标记为失败。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update source_scan_runs
                set status = 'failed',
                    error_category = 'worker_lease_expired',
                    error_message = 'Worker 租约在当前扫描批次结束前已过期。',
                    finished_at = now(),
                    worker_id = null,
                    lease_expires_at = null
                where (
                    status = 'running' and (lease_expires_at is null or lease_expires_at < now())
                  ) or (
                    status = 'waiting_downloads' and lease_expires_at < now()
                  )
                """
            )
            recovered = cur.rowcount
        conn.commit()
    return recovered


def count_expired_source_scan_leases() -> int:
    """统计租约已过期的扫描运行数量。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select count(*)::int as count
                from source_scan_runs
                where (
                    status = 'running' and (lease_expires_at is null or lease_expires_at < now())
                  ) or (
                    status = 'waiting_downloads' and lease_expires_at < now()
                  )
                """
            )
            return int(cur.fetchone()["count"])


def fetch_due_history_source() -> dict[str, object] | None:
    """读取下一个到达扫描时间的活跃来源。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select *
                from archive_sources
                where status = 'active'
                  and deleted_at is null
                  and cursor_state->>'automation_enabled' = 'true'
                  and (next_scan_at is null or next_scan_at <= now())
                order by coalesce(next_scan_at, now()), id
                limit 1
                """
            )
            row = cur.fetchone()
            return dict(ArchiveSourceRow.model_validate(dict(row))) if row else None


def schedule_next_history_scan(
    source_id: int,
    settings: Settings,
    state: str,
    *,
    min_delay_seconds: float | None = None,
) -> None:
    """带随机抖动地安排下一次自动扫描。"""

    source = get_source(source_id)
    cursor_state = source.get("cursor_state") if source and isinstance(source.get("cursor_state"), dict) else {}
    if not source or source.get("status") != "active" or not cursor_state.get("automation_enabled"):
        return
    delay = random.uniform(
        min(settings.source_scan_sleep_min_seconds, settings.source_scan_sleep_max_seconds),
        max(settings.source_scan_sleep_min_seconds, settings.source_scan_sleep_max_seconds),
    )
    if min_delay_seconds is not None:
        delay = max(delay, min_delay_seconds)
    update_history_scan_state(source_id, state, delay_seconds=delay)


def pause_history_scan_for_error(source_id: int, error_category: str) -> None:
    """因为外部持久性错误而暂停当前 history 扫描会话。"""

    update_history_scan_state(source_id, error_category, enabled=True, status="paused")


def finish_history_scan(source_id: int) -> None:
    """标记当前扫描会话完成，并更新来源状态。"""

    source = get_source(source_id)
    cursor_state = source.get("cursor_state") if source and isinstance(source.get("cursor_state"), dict) else {}
    mode = cursor_state.get("active_scan_mode") or "history"
    status = "completed" if mode == "history" else "active"
    update_history_scan_state(source_id, "completed", enabled=False, status=status)


def update_history_scan_state(
    source_id: int,
    state: str,
    *,
    delay_seconds: float | None = None,
    enabled: bool | None = None,
    status: str | None = None,
) -> None:
    """持久化扫描会话状态与下一次调度时间。"""

    source = get_source(source_id)
    if source is None:
        return
    cursor_state = source.get("cursor_state") if isinstance(source.get("cursor_state"), dict) else {}
    cursor_state = set_active_scan_session_state(cursor_state, state, enabled=enabled)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update archive_sources
                set cursor_state = %s,
                    status = coalesce(%s, status),
                    next_scan_at = case
                      when %s is null then null
                      else now() + make_interval(secs => %s)
                    end,
                    updated_at = now()
                where id = %s
                """,
                (Jsonb(cursor_state), status, delay_seconds, delay_seconds, source_id),
            )
        conn.commit()


def start_source_scan_run(
    source_id: int,
    trigger_type: str,
    scan_range: dict[str, int],
    cursor_before: dict[str, Any],
    worker_id: str | None = None,
) -> int:
    """创建一条运行中的 ``source_scan_runs`` 记录及其日志流。"""

    if trigger_type not in VALID_SCAN_TRIGGERS:
        raise ValueError("invalid_scan_trigger")
    with connect() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    """
                    insert into source_scan_runs (
                        source_id, trigger_type, status, range_start, range_end,
                        requested_limit, cursor_before, started_at,
                        worker_id, claimed_at, lease_expires_at
                    )
                    values (
                        %s, %s, 'running', %s, %s, %s, %s, now(),
                        %s,
                        case when %s::text is null then null else now() end,
                        case when %s::text is null then null else now() + make_interval(secs => %s) end
                    )
                    returning id
                    """,
                    (
                        source_id,
                        trigger_type,
                        scan_range["start"],
                        scan_range["end"],
                        scan_range["limit"],
                        Jsonb(cursor_before),
                        worker_id,
                        worker_id,
                        worker_id,
                        LEASE_SECONDS,
                    ),
                )
            except UniqueViolation as exc:
                raise ValueError("source_scan_in_progress") from exc
            run_id = IdRow.model_validate(dict(cur.fetchone())).id
        conn.commit()
    log_path = source_scan_log_relative_path(source_id, run_id)
    log_stream_id = create_operation_log_stream(
        "source_scan",
        run_id,
        log_path,
        {
            "source_id": source_id,
            "trigger_type": trigger_type,
            "range_start": scan_range["start"],
            "range_end": scan_range["end"],
            "requested_limit": scan_range["limit"],
            "worker_id": worker_id,
        },
    )
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update source_scan_runs
                set log_stream_id = %s
                where id = %s
                """,
                (log_stream_id, run_id),
            )
        conn.commit()
    publish_event(
        "source_scans",
        "source.scan.started",
        {"source_id": source_id, "scan_run_id": run_id, "trigger_type": trigger_type, "range": scan_range},
    )
    return run_id


def finish_source_scan_run(
    scan_run_id: int,
    status: str,
    *,
    cursor_after: dict[str, Any],
    discovered_tweet_count: int = 0,
    new_tweet_count: int = 0,
    duplicate_tweet_count: int = 0,
    discovered_media_count: int = 0,
    error_category: str | None = None,
    error_message: str | None = None,
    worker_id: str | None = None,
) -> None:
    """收敛扫描运行记录，并发送完成事件。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update source_scan_runs
                set status = %s,
                    cursor_after = %s,
                    discovered_tweet_count = %s,
                    new_tweet_count = %s,
                    duplicate_tweet_count = %s,
                    discovered_media_count = %s,
                    error_category = %s,
                    error_message = %s,
                    finished_at = now(),
                    worker_id = null,
                    lease_expires_at = null
                where id = %s
                  and (%s::text is null or worker_id = %s)
                """,
                (
                    status,
                    Jsonb(cursor_after),
                    discovered_tweet_count,
                    new_tweet_count,
                    duplicate_tweet_count,
                    discovered_media_count,
                    error_category,
                    error_message,
                    scan_run_id,
                    worker_id,
                    worker_id,
                ),
            )
            if worker_id is not None and cur.rowcount != 1:
                raise WorkerLeaseLost("source_scan_lease_lost")
        conn.commit()
    close_source_scan_log_stream(scan_run_id)
    publish_event(
        "source_scans",
        "source.scan.completed",
        {
            "scan_run_id": scan_run_id,
            "status": status,
            "discovered_tweet_count": discovered_tweet_count,
            "new_tweet_count": new_tweet_count,
            "duplicate_tweet_count": duplicate_tweet_count,
            "discovered_media_count": discovered_media_count,
            "error_category": error_category,
        },
    )


def record_waiting_downloads_scan(
    source_id: int,
    cursor_state: dict[str, Any],
    limit: int,
    trigger_type: str = "history_worker",
) -> None:
    """记录一次因下载积压而被延后的来源扫描。"""

    scan_range = build_active_scan_range(cursor_state, limit)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                with latest as (
                    select id
                    from source_scan_runs
                    where source_id = %s
                    order by created_at desc, id desc
                    limit 1
                )
                update source_scan_runs r
                set cursor_after = %s,
                    finished_at = now()
                from latest
                where r.id = latest.id
                  and r.status = 'waiting_downloads'
                  and r.trigger_type = %s
                  and r.range_start = %s
                  and r.range_end = %s
                  and r.requested_limit = %s
                returning r.id
                """,
                (
                    source_id,
                    Jsonb(cursor_state),
                    trigger_type,
                    scan_range["start"],
                    scan_range["end"],
                    scan_range["limit"],
                ),
            )
            if cur.rowcount:
                scan_run_id = int(cur.fetchone()["id"])
                conn.commit()
                publish_event(
                    "source_scans",
                    "source.scan.waiting_downloads",
                    {
                        "source_id": source_id,
                        "scan_run_id": scan_run_id,
                        "range": scan_range,
                        "status": "waiting_downloads",
                        "trigger_type": trigger_type,
                    },
                )
                return
            cur.execute(
                """
                insert into source_scan_runs (
                    source_id, trigger_type, status, range_start, range_end,
                    requested_limit, cursor_before, cursor_after, started_at, finished_at
                )
                values (%s, %s, 'waiting_downloads', %s, %s, %s, %s, %s, now(), now())
                returning id
                """,
                (
                    source_id,
                    trigger_type,
                    scan_range["start"],
                    scan_range["end"],
                    scan_range["limit"],
                    Jsonb(cursor_state),
                    Jsonb(cursor_state),
                ),
            )
            scan_run_id = int(cur.fetchone()["id"])
        conn.commit()
    publish_event(
        "source_scans",
        "source.scan.waiting_downloads",
        {
            "source_id": source_id,
            "scan_run_id": scan_run_id,
            "range": scan_range,
            "status": "waiting_downloads",
            "trigger_type": trigger_type,
        },
    )


def record_source_scan_failure(
    source_id: int,
    cursor_state: dict[str, Any],
    limit: int,
    trigger_type: str,
    error: Exception,
) -> None:
    """为扫描前编排阶段的异常落一条合成失败扫描记录。"""

    run_id = start_source_scan_run(source_id, trigger_type, build_active_scan_range(cursor_state, limit), cursor_state)
    message = str(error) or error.__class__.__name__
    mark_source_scan_result(source_id, error_category="failed", error_message=message)
    finish_source_scan_run(
        run_id,
        "failed",
        cursor_after=cursor_state,
        error_category="failed",
        error_message=message,
    )


def scan_source(
    source_id: int,
    limit: int = 20,
    restart: bool = False,
    settings: Settings | None = None,
    trigger_type: str | None = None,
    session_mode: str | None = None,
    worker_id: str | None = None,
) -> dict[str, object]:
    """为某个来源执行一批 gallery-dl 发现扫描。"""

    settings = settings or get_settings()
    limit = normalize_scan_limit(limit)
    source = get_source(source_id)
    if source is None:
        raise ValueError("source_not_found")
    if str(source.get("status")) == "paused":
        raise ValueError("source_paused")
    source_url = str(source.get("source_url") or "")
    source_type = str(source.get("source_type") or "")
    if source_type not in {"profile", "user_media", "likes"}:
        raise ValueError("source_scan_not_supported")
    scan_url = build_gallery_dl_scan_url(source_type, source_url)
    cursor_state = source.get("cursor_state") if isinstance(source.get("cursor_state"), dict) else {}
    scan_trigger = trigger_type or ("latest_refresh" if restart else "manual_next")
    mode = normalize_session_mode_for_trigger(scan_trigger, session_mode)
    advances_cursor = scan_trigger != "latest_refresh" or session_mode == "latest_refresh"
    session = get_scan_session(cursor_state, mode) if mode else {}
    scan_cursor = None if not advances_cursor else session.get("extractor_cursor") or cursor_state.get("extractor_cursor")
    range_state = session if mode else cursor_state
    scan_range = build_scan_range(range_state, limit, restart=restart)
    scan_run_id = start_source_scan_run(source_id, scan_trigger, scan_range, cursor_state, worker_id=worker_id)
    log_source_scan_event(
        "source.scan.started",
        source_id=source_id,
        scan_run_id=scan_run_id,
        trigger_type=scan_trigger,
        range_start=scan_range["start"],
        range_end=scan_range["end"],
        limit=scan_range["limit"],
        restart=restart,
    )
    try:
        with SourceScanLeaseHeartbeat(scan_run_id, worker_id) as lease:
            # 发现结果落库和游标推进前都会反复检查租约，避免失去所有权的
            # worker 继续提交过期进度。
            records, scan_meta = discover_records_with_gallery_dl(
                scan_url,
                scan_range["start"],
                scan_range["end"],
                settings.source_scan_sleep_min_seconds,
                settings.source_scan_sleep_max_seconds,
                settings.source_scan_http_timeout_seconds,
                settings.source_scan_http_retries,
                continuation_cursor=str(scan_cursor) if scan_cursor else None,
                cookie_path=prepare_cookies(settings),
                scan_run_id=scan_run_id,
                worker_id=worker_id,
            )
            ensure_source_scan_lease(scan_run_id, worker_id)
            result = finish_scan_source_result(
                source_id=source_id,
                scan_run_id=scan_run_id,
                records=records,
                scan_meta=scan_meta,
                scan_range=scan_range,
                cursor_state=cursor_state,
                advances_history=advances_cursor,
                session_mode=mode,
                worker_id=worker_id,
                lease=lease,
            )
            return result
    except Exception as exc:
        if isinstance(exc, WorkerLeaseLost):
            raise
        append_source_scan_log(
            scan_run_id,
            "error",
            "source-scan",
            f"来源扫描失败：{exc}",
            worker_id=worker_id,
            exception=exc,
        )
        mark_source_scan_result(source_id, error_category="failed", error_message=str(exc))
        finish_source_scan_run(
            scan_run_id,
            "failed",
            cursor_after=cursor_state,
            error_category="failed",
            error_message=str(exc),
            worker_id=worker_id,
        )
        log_source_scan_event(
            "source.scan.failed",
            source_id=source_id,
            scan_run_id=scan_run_id,
            error_type=type(exc).__name__,
        )
        raise


def finish_scan_source_result(
    *,
    source_id: int,
    scan_run_id: int,
    records: list[dict[str, Any]],
    scan_meta: dict[str, object],
    scan_range: dict[str, int],
    cursor_state: dict[str, Any],
    advances_history: bool,
    session_mode: str | None,
    worker_id: str | None,
    lease: SourceScanLeaseHeartbeat,
) -> dict[str, object]:
    """持久化发现结果、推进游标状态，并结束本次扫描运行。"""

    if not records:
        lease.ensure_active()
        scan_succeeded = scan_meta.get("exit_code") == 0 and not scan_meta.get("error_category")
        completed = scan_succeeded and advances_history
        ensure_source_scan_lease(scan_run_id, worker_id)
        cursor_after = (
            update_source_cursor(
                source_id,
                scan_meta,
                scan_range,
                discovered_count=0,
                new_discovered_count=0,
                completed=completed,
                session_mode=session_mode,
            )
            if advances_history and scan_succeeded
            else cursor_state
        )
        error_category = None if scan_succeeded else str(scan_meta.get("error_category") or "failed")
        error_message = (
            None if scan_succeeded else str(scan_meta.get("error_message") or "当前来源未发现任何推文。")
        )
        ensure_source_scan_lease(scan_run_id, worker_id)
        mark_source_scan_result(source_id, error_category=error_category, error_message=error_message)
        ensure_source_scan_lease(scan_run_id, worker_id)
        finish_source_scan_run(
            scan_run_id,
            scan_run_status(scan_meta, completed),
            cursor_after=cursor_after,
            error_category=error_category,
            error_message=error_message,
            worker_id=worker_id,
        )
        log_source_scan_event(
            "source.scan.completed",
            source_id=source_id,
            scan_run_id=scan_run_id,
            status=scan_run_status(scan_meta, completed),
            discovered_count=0,
            new_discovered_count=0,
            duplicate_count=0,
            completed=completed,
            error_category=error_category,
        )
        return {
            "source_id": source_id,
            "scan_run_id": scan_run_id,
            "discovered_count": 0,
            "new_discovered_count": 0,
            "duplicate_count": 0,
            "completed": completed,
            "submitted": None,
            "scanner": scan_meta,
        }

    lease.ensure_active()
    ensure_source_scan_lease(scan_run_id, worker_id)
    result = record_source_discoveries(source_id, records, mark_scanned=True)
    completed = advances_history and is_scan_session_complete(
        session_mode,
        scan_meta,
        scan_range,
        int(result["discovered_count"]),
        int(result["duplicate_count"]),
    )
    ensure_source_scan_lease(scan_run_id, worker_id)
    cursor_after = (
        update_source_cursor(
            source_id,
            scan_meta,
            scan_range,
            discovered_count=int(result["discovered_count"]),
            new_discovered_count=int(result["new_discovered_count"]),
            completed=completed,
            session_mode=session_mode,
        )
        if advances_history
        else cursor_state
    )
    ensure_source_scan_lease(scan_run_id, worker_id)
    mark_source_scan_result(source_id)
    lease.ensure_active()
    ensure_source_scan_lease(scan_run_id, worker_id)
    finish_source_scan_run(
        scan_run_id,
        scan_run_status(scan_meta, completed),
        cursor_after=cursor_after,
        discovered_tweet_count=int(result["discovered_count"]),
        new_tweet_count=int(result["new_discovered_count"]),
        duplicate_tweet_count=int(result["duplicate_count"]),
        discovered_media_count=count_discovered_media(records),
        worker_id=worker_id,
    )
    log_source_scan_event(
        "source.scan.completed",
        source_id=source_id,
        scan_run_id=scan_run_id,
        status=scan_run_status(scan_meta, completed),
        discovered_count=result["discovered_count"],
        new_discovered_count=result["new_discovered_count"],
        duplicate_count=result["duplicate_count"],
        discovered_media_count=count_discovered_media(records),
        completed=completed,
    )
    return {
        "source_id": source_id,
        "scan_run_id": scan_run_id,
        "discovered_count": result["discovered_count"],
        "new_discovered_count": result["new_discovered_count"],
        "duplicate_count": result["duplicate_count"],
        "completed": completed,
        "submitted": None,
        "scanner": scan_meta,
    }


def discover_records_with_gallery_dl(
    source_url: str,
    start: int,
    end: int,
    sleep_min_seconds: float = 2.0,
    sleep_max_seconds: float = 6.0,
    http_timeout_seconds: float = 15.0,
    http_retries: int = 2,
    continuation_cursor: str | None = None,
    cookie_path: Path | None = None,
    scan_run_id: int | None = None,
    worker_id: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, object]]:
    """执行 gallery-dl，并把其 JSON 输出转换成规范推文记录。"""

    if start < 1 or end < start:
        raise ValueError("scan_limit_required")
    if shutil.which("gallery-dl") is None:
        return [], {"error_category": "command_not_found", "error_message": "gallery-dl"}
    command = [
        "gallery-dl",
        "--config",
        "/app/gallery-dl.conf",
        "--dump-json",
        "--sleep-request",
        format_sleep_range(sleep_min_seconds, sleep_max_seconds),
        "--http-timeout",
        f"{http_timeout_seconds:g}",
        "--retries",
        str(http_retries),
    ]
    if cookie_path is not None:
        command.extend(
            [
                "-o",
                f"extractor.twitter.cookies={cookie_path}",
                "-o",
                "extractor.twitter.cookies-update=false",
            ]
        )
    limit = end - start + 1
    command.extend(["--verbose", "-o", f"limit={limit}", "--post-range", f"1-{limit}"])
    if continuation_cursor:
        command.extend(["-o", f"cursor={continuation_cursor}"])
    command.append(source_url)
    result = (
        run_gallery_dl_streaming(command, scan_run_id, worker_id)
        if scan_run_id is not None
        else subprocess.run(command, capture_output=True, text=True, check=False)
    )
    stderr_excerpt = result.stderr[-4000:] if result.stderr else None
    if result.returncode != 0:
        return [], {
            "exit_code": result.returncode,
            "error_category": classify_source_error(stderr_excerpt),
            "error_message": stderr_excerpt or f"gallery-dl exited with {result.returncode}",
        }
    # gallery-dl 在 HTTP 重试耗尽后仍可能返回 0，因此在判定成功前，
    # 仍需要检查 stderr。
    soft_error = detect_gallery_dl_exhausted_retry(result.stderr)
    if soft_error is not None:
        error_category, error_message = soft_error
        if scan_run_id is not None:
            append_source_scan_log(
                scan_run_id,
                "error",
                "source-scan",
                f"gallery-dl exhausted HTTP retries despite exit code 0: {error_message}",
                worker_id=worker_id,
            )
        return [], {
            "exit_code": result.returncode,
            "error_category": error_category,
            "error_message": error_message,
            "stderr_excerpt": stderr_excerpt,
        }
    records = parse_gallery_dl_records(result.stdout, source_url)
    return records, {
        "exit_code": result.returncode,
        "raw_record_count": len(records),
        "stderr_excerpt": None,
        "scan_url": source_url,
        "range_start": start,
        "range_end": end,
        "cursor_mode": "native",
        "continuation_cursor": extract_gallery_dl_cursor(result.stderr),
    }


def detect_gallery_dl_exhausted_retry(stderr: str | None) -> tuple[str, str] | None:
    """识别被 0 退出码掩盖的“重试已耗尽”场景。"""

    for line in reversed((stderr or "").splitlines()):
        match = re.search(r"\((\d+)/(\d+)\)\s*$", line)
        if match is None or match.group(1) != match.group(2):
            continue
        category = classify_source_error(line)
        if category != ErrorCategory.UNKNOWN.value:
            return category, line[-1000:]
    return None


def run_gallery_dl_streaming(command: list[str], scan_run_id: int, worker_id: str | None) -> subprocess.CompletedProcess[str]:
    """执行 gallery-dl，并把 stderr 持续流式写入操作日志。"""

    append_source_scan_log(scan_run_id, "info", "gallery-dl", "开始执行 gallery-dl。", worker_id=worker_id)
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        start_new_session=True,
    )
    stdout_chunks: list[str] = []
    stderr_chunks: deque[str] = deque(maxlen=SOURCE_SCAN_STDERR_TAIL_LINES)
    pending_logs: Queue[dict[str, object]] = Queue(maxsize=SOURCE_SCAN_LOG_QUEUE_SIZE)
    reader_errors: Queue[tuple[str, BaseException]] = Queue(maxsize=2)
    pending_logs_ready = Event()
    stop_readers = Event()

    def read_stdout() -> None:
        try:
            assert process.stdout is not None
            for chunk in process.stdout:
                if stop_readers.is_set():
                    break
                stdout_chunks.append(chunk)
        except Exception as exc:
            try:
                reader_errors.put_nowait(("stdout", exc))
            except Full:
                pass
            stop_readers.set()
            pending_logs_ready.set()

    def read_stderr() -> None:
        try:
            assert process.stderr is not None
            for line in process.stderr:
                stderr_chunks.append(line)
                entry = {
                    "level": parse_gallery_dl_log_level(line),
                    "component": "gallery-dl",
                    "message": line,
                    "raw": line,
                }
                while not stop_readers.is_set():
                    try:
                        pending_logs.put(
                            entry,
                            timeout=SOURCE_SCAN_LOG_QUEUE_PUT_TIMEOUT_SECONDS,
                        )
                    except Full:
                        continue
                    if pending_logs.qsize() >= SOURCE_SCAN_LOG_BATCH_SIZE:
                        pending_logs_ready.set()
                    break
                if stop_readers.is_set():
                    break
        except Exception as exc:
            try:
                reader_errors.put_nowait(("stderr", exc))
            except Full:
                pass
            stop_readers.set()
            pending_logs_ready.set()

    def raise_reader_error() -> None:
        try:
            stream_name, error = reader_errors.get_nowait()
        except Empty:
            return
        raise RuntimeError(f"gallery_dl_{stream_name}_reader_failed") from error

    def flush_pending_logs() -> bool:
        entries: list[dict[str, object]] = []
        for _ in range(SOURCE_SCAN_LOG_BATCH_SIZE):
            try:
                entries.append(pending_logs.get_nowait())
            except Empty:
                break
        if not entries:
            return False
        if not pending_logs.empty():
            pending_logs_ready.set()
        append_source_scan_logs(scan_run_id, entries, worker_id=worker_id)
        return True

    stdout_thread = Thread(target=read_stdout, name="source-scan-gallery-dl-stdout", daemon=True)
    stderr_thread = Thread(target=read_stderr, name="source-scan-gallery-dl-stderr", daemon=True)
    reader_drain_timed_out = False
    primary_error: BaseException | None = None
    try:
        stdout_thread.start()
        stderr_thread.start()
        while process.poll() is None:
            pending_logs_ready.wait(timeout=SOURCE_SCAN_LOG_FLUSH_SECONDS)
            pending_logs_ready.clear()
            raise_reader_error()
            flush_pending_logs()
            raise_reader_error()
        return_code = process.wait()
        drain_deadline = time.monotonic() + SOURCE_SCAN_READER_DRAIN_TIMEOUT_SECONDS
        while stdout_thread.is_alive() or stderr_thread.is_alive() or not pending_logs.empty():
            raise_reader_error()
            if not pending_logs.empty():
                flush_pending_logs()
            remaining = drain_deadline - time.monotonic()
            if remaining <= 0:
                reader_drain_timed_out = True
                raise RuntimeError("gallery_dl_reader_drain_timeout")
            join_timeout = min(0.05, remaining)
            stdout_thread.join(timeout=join_timeout)
            stderr_thread.join(timeout=join_timeout)
        raise_reader_error()
        append_source_scan_log(
            scan_run_id,
            "info",
            "gallery-dl",
            f"gallery-dl 已退出，退出码为 {return_code}。",
            worker_id=worker_id,
        )
        return subprocess.CompletedProcess(
            args=command,
            returncode=return_code,
            stdout="".join(stdout_chunks),
            stderr="".join(stderr_chunks),
        )
    except BaseException as exc:
        primary_error = exc
        raise
    finally:
        stop_readers.set()
        _stop_gallery_dl_process(
            process,
            include_process_group=reader_drain_timed_out or process.poll() is None,
        )
        for stream in (process.stdout, process.stderr):
            close = getattr(stream, "close", None)
            if not callable(close):
                continue
            try:
                close()
            except (OSError, ValueError):
                logger.warning("Failed to close gallery-dl output pipe", exc_info=True)
        for thread in (stdout_thread, stderr_thread):
            if thread.ident is not None:
                thread.join(timeout=SOURCE_SCAN_READER_JOIN_TIMEOUT_SECONDS)
                if thread.is_alive():
                    logger.error("gallery-dl reader thread did not stop: %s", thread.name)
        try:
            while not pending_logs.empty():
                flush_pending_logs()
        except Exception as exc:
            if primary_error is None:
                raise
            primary_error.add_note(f"pending source scan log flush failed: {exc!r}")
            logger.error(
                "Failed to flush pending source scan logs while handling an earlier error",
                exc_info=True,
            )


def _stop_gallery_dl_process(
    process: subprocess.Popen[str],
    *,
    include_process_group: bool = False,
) -> None:
    """终止仍在运行的 gallery-dl，并在超时后强制回收。"""

    stop_process_group(
        process,
        timeout_seconds=SOURCE_SCAN_PROCESS_STOP_TIMEOUT_SECONDS,
        include_process_group=include_process_group,
    )


def append_source_scan_log(
    scan_run_id: int,
    level: str,
    component: str,
    message: str,
    *,
    worker_id: str | None = None,
    exception: BaseException | None = None,
) -> None:
    """追加扫描日志，并把末尾进度同步到 ``source_scan_runs``。"""

    append_source_scan_logs(
        scan_run_id,
        [
            {
                "level": level,
                "component": component,
                "message": message,
                "raw": message,
                "exception": exception,
            }
        ],
        worker_id=worker_id,
    )


def append_source_scan_logs(
    scan_run_id: int,
    entries: list[dict[str, object]],
    *,
    worker_id: str | None = None,
) -> None:
    """批量追加扫描日志，并以最后一行更新扫描进度。"""

    prepared: list[dict[str, object]] = []
    for entry in entries:
        text = redact_sensitive_text(str(entry.get("message") or "")).strip()
        if not text:
            continue
        raw = entry.get("raw")
        prepared.append(
            {
                "level": str(entry.get("level") or "info"),
                "component": str(entry.get("component") or "gallery-dl"),
                "message": text[-500:],
                "raw": str(raw) if raw is not None else None,
                "context": {"scan_run_id": scan_run_id, "worker_id": worker_id},
                "exception": entry.get("exception"),
            }
        )
    if not prepared:
        return
    progress = str(prepared[-1]["message"])
    log_stream_id = fetch_source_scan_log_stream_id(scan_run_id)
    if log_stream_id:
        append_operation_log_entries(log_stream_id, prepared)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update source_scan_runs
                set progress_message = %s,
                    last_log_at = now()
                where id = %s
                  and status = 'running'
                  and (%s::text is null or worker_id = %s)
                """,
                (progress, scan_run_id, worker_id, worker_id),
            )
        conn.commit()
    publish_event(
        "source_scans",
        "source.scan.log",
        {
            "scan_run_id": scan_run_id,
            "progress_message": progress,
            "log_stream_id": log_stream_id,
            "entry_count": len(prepared),
        },
    )


def source_scan_log_relative_path(source_id: int, scan_run_id: int) -> str:
    """构造来源扫描日志对应的 archive 相对 JSONL 路径。"""

    return f"logs/source-scan-logs/source-{source_id}/scan-run-{scan_run_id}.jsonl"


def fetch_source_scan_log_stream_id(scan_run_id: int) -> int | None:
    """读取某次扫描运行关联的日志流 ID。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select log_stream_id from source_scan_runs where id = %s", (scan_run_id,))
            row = cur.fetchone()
    return int(row["log_stream_id"]) if row and row["log_stream_id"] else None


def close_source_scan_log_stream(scan_run_id: int) -> None:
    """关闭某次扫描运行关联的日志流。"""

    log_stream_id = fetch_source_scan_log_stream_id(scan_run_id)
    if log_stream_id:
        close_operation_log_stream(log_stream_id)


def format_sleep_range(min_seconds: float, max_seconds: float) -> str:
    """格式化 gallery-dl 的休眠区间参数。"""

    start = min(min_seconds, max_seconds)
    end = max(min_seconds, max_seconds)
    start_text = f"{start:g}"
    end_text = f"{end:g}"
    return start_text if start == end else f"{start_text}-{end_text}"


def build_scan_range(cursor_state: dict[str, Any], limit: int, restart: bool = False) -> dict[str, int]:
    """为下一批 gallery-dl 扫描构造明确的 [start, end] 区间。"""

    if limit < MIN_SOURCE_SCAN_LIMIT:
        raise ValueError("scan_limit_required")
    start = 1 if restart else parse_positive_int(cursor_state.get("next_start_index"), default=1)
    end = start + limit - 1
    return {"start": start, "end": end, "limit": limit}


def build_active_scan_range(cursor_state: dict[str, Any], limit: int, restart: bool = False) -> dict[str, int]:
    """在构造扫描区间前，先解析当前活跃会话的状态。"""

    mode = cursor_state.get("active_scan_mode")
    range_state = get_scan_session(cursor_state, str(mode)) if mode in VALID_SCAN_SESSION_MODES else cursor_state
    return build_scan_range(range_state, limit, restart=restart)


def is_source_scan_complete(scan_meta: dict[str, object], scan_range: dict[str, int], discovered_count: int) -> bool:
    """判断 gallery-dl 是否表明该来源已经没有后续游标。"""

    if scan_meta.get("exit_code") != 0 or scan_meta.get("error_category"):
        return False
    return not scan_meta.get("continuation_cursor")


def is_scan_session_complete(
    mode: str | None,
    scan_meta: dict[str, object],
    scan_range: dict[str, int],
    discovered_count: int,
    duplicate_count: int,
) -> bool:
    """按不同扫描模式的规则判断扫描会话是否结束。"""

    if mode is None:
        return False
    if scan_meta.get("exit_code") != 0 or scan_meta.get("error_category"):
        return False
    if mode == "latest_refresh" and duplicate_count > LATEST_REFRESH_DUPLICATE_THRESHOLD:
        return True
    return is_source_scan_complete(scan_meta, scan_range, discovered_count)


def extract_gallery_dl_cursor(stderr: str | None) -> str | None:
    """从 gallery-dl 的 verbose 日志中提取 continuation cursor。"""

    matches = re.findall(r"Cursor:\s+(\S+)", stderr or "")
    if not matches:
        return None
    cursor = matches[-1].strip()
    if cursor.lower() in {"none", "null"}:
        return None
    return cursor


def scan_run_status(scan_meta: dict[str, object], completed: bool) -> str:
    """把 gallery-dl 元数据映射成 ``source_scan_runs.status``。"""

    category = str(scan_meta.get("error_category") or "")
    if category in {"rate_limited", "auth_required", "network_error"}:
        return category
    if completed:
        return "completed_empty_batch" if int(scan_meta.get("raw_record_count") or 0) == 0 else "completed_end_of_source"
    if scan_meta.get("exit_code") == 0:
        return "succeeded"
    return "failed"


def count_discovered_media(records: list[dict[str, Any]]) -> int:
    """统计规范扫描记录中的媒体总数。"""

    return sum(parse_positive_int(record.get("media_count"), 0) for record in records)


def parse_positive_int(value: object, default: int) -> int:
    """解析正整数；不合法时回退到 ``default``。"""

    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed >= 1 else default


def normalize_scan_limit(limit: int) -> int:
    """校验扫描批大小，并限制到支持的上限。"""

    parsed = int(limit)
    if parsed < MIN_SOURCE_SCAN_LIMIT:
        raise ValueError("scan_limit_required")
    return min(200, parsed)


def normalize_scan_session_mode(mode: str) -> str:
    """校验允许的扫描会话模式。"""

    value = str(mode or "").strip()
    if value not in VALID_SCAN_SESSION_MODES:
        raise ValueError("invalid_scan_session_mode")
    return value


def normalize_session_mode_for_trigger(trigger_type: str, session_mode: str | None) -> str | None:
    """在必要时根据触发器推断逻辑扫描模式。"""

    if session_mode:
        return normalize_scan_session_mode(session_mode)
    if trigger_type == "history_worker":
        return "history"
    if trigger_type == "latest_refresh":
        return "latest_refresh"
    if trigger_type == "from_start_repair":
        return "from_start"
    return None


def get_scan_sessions(cursor_state: dict[str, Any]) -> dict[str, Any]:
    """从游标状态中取出嵌套的扫描会话映射。"""

    sessions = cursor_state.get("scan_sessions")
    return sessions if isinstance(sessions, dict) else {}


def get_scan_session(cursor_state: dict[str, Any], mode: str) -> dict[str, Any]:
    """返回单个会话快照，并兼容旧版 history 数据结构。"""

    sessions = get_scan_sessions(cursor_state)
    session = sessions.get(mode)
    if isinstance(session, dict):
        return session
    if mode == "history":
        return {
            "next_start_index": cursor_state.get("next_start_index"),
            "extractor_cursor": cursor_state.get("extractor_cursor"),
            "limit": cursor_state.get("automation_limit") or cursor_state.get("last_limit"),
            "completed": cursor_state.get("last_completed"),
        }
    return {"next_start_index": 1}


def start_scan_session_state(cursor_state: dict[str, Any], mode: str, limit: int, restart: bool = False) -> dict[str, Any]:
    """为新启动的扫描会话构造下一份 cursor_state 载荷。"""

    sessions = dict(get_scan_sessions(cursor_state))
    previous = {} if restart else get_scan_session(cursor_state, mode)
    session = {
        **previous,
        "mode": mode,
        "state": "running",
        "limit": limit,
        "completed": False,
    }
    if restart or "next_start_index" not in session:
        session["next_start_index"] = 1
        session.pop("extractor_cursor", None)
    sessions[mode] = session
    next_state = {
        **cursor_state,
        "active_scan_mode": mode,
        "automation_enabled": True,
        "automation_state": "running",
        "automation_limit": limit,
        "scan_sessions": sessions,
        "last_completed": False,
    }
    if mode == "history":
        next_state["next_start_index"] = session.get("next_start_index") or 1
        if session.get("extractor_cursor"):
            next_state["extractor_cursor"] = session.get("extractor_cursor")
        elif restart:
            next_state.pop("extractor_cursor", None)
    return next_state


def ensure_legacy_active_scan_session(cursor_state: dict[str, Any]) -> dict[str, Any]:
    """为旧来源补齐 ``scan_sessions`` 字段，兼容会话化之前的数据。"""

    sessions = dict(get_scan_sessions(cursor_state))
    if "history" not in sessions:
        sessions["history"] = {
            "mode": "history",
            "state": cursor_state.get("automation_state", "running"),
            "next_start_index": cursor_state.get("next_start_index"),
            "extractor_cursor": cursor_state.get("extractor_cursor"),
            "limit": cursor_state.get("automation_limit") or cursor_state.get("last_limit"),
            "completed": bool(cursor_state.get("last_completed")),
        }
    return {**cursor_state, "active_scan_mode": "history", "scan_sessions": sessions}


def set_active_scan_session_state(
    cursor_state: dict[str, Any],
    state: str,
    *,
    enabled: bool | None = None,
) -> dict[str, Any]:
    """更新当前活跃扫描会话的状态。"""

    mode = cursor_state.get("active_scan_mode")
    sessions = dict(get_scan_sessions(cursor_state))
    if mode in VALID_SCAN_SESSION_MODES:
        session = {**get_scan_session(cursor_state, str(mode)), "state": state}
        sessions[str(mode)] = session
    next_state = {**cursor_state, "automation_state": state, "scan_sessions": sessions}
    if enabled is not None:
        next_state["automation_enabled"] = enabled
    return next_state


def update_session_progress_state(
    cursor_state: dict[str, Any],
    mode: str,
    progress_state: dict[str, Any],
    completed: bool,
) -> dict[str, Any]:
    """写入会话级进度，同时保持共享游标字段一致。"""

    sessions = dict(get_scan_sessions(cursor_state))
    session = {
        **get_scan_session(cursor_state, mode),
        **progress_state,
        "mode": mode,
        "state": "completed" if completed else "running",
        "completed": completed,
    }
    sessions[mode] = session
    flat_progress = dict(progress_state)
    if mode != "history":
        flat_progress.pop("next_start_index", None)
        flat_progress.pop("extractor_cursor", None)
        flat_progress.pop("last_completed", None)
    next_state = {
        "scan_sessions": sessions,
        "active_scan_mode": mode,
        "automation_state": "completed" if completed else cursor_state.get("automation_state", "running"),
        "automation_enabled": False if completed else cursor_state.get("automation_enabled", True),
        "automation_limit": session.get("limit") or session.get("last_limit") or progress_state["last_limit"],
        **flat_progress,
    }
    if mode == "history":
        next_state["next_start_index"] = progress_state["next_start_index"]
        next_state["extractor_cursor"] = progress_state.get("extractor_cursor")
        next_state["last_completed"] = completed
    return next_state


def update_source_cursor(
    source_id: int,
    scan_meta: dict[str, object],
    scan_range: dict[str, int],
    discovered_count: int,
    new_discovered_count: int,
    completed: bool,
    session_mode: str | None = None,
) -> dict[str, Any]:
    """在单批扫描结束后持久化游标推进结果。"""

    duplicate_count = max(discovered_count - new_discovered_count, 0)
    has_continuation = bool(scan_meta.get("continuation_cursor"))
    next_start = scan_range["end"] + 1 if discovered_count > 0 or has_continuation else scan_range["start"]
    progress_state = {
        "next_start_index": next_start,
        "last_range_start": scan_range["start"],
        "last_range_end": scan_range["end"],
        "last_limit": scan_range["limit"],
        "last_scan_url": scan_meta.get("scan_url"),
        "last_raw_record_count": scan_meta.get("raw_record_count", 0),
        "last_discovered_count": discovered_count,
        "last_new_discovered_count": new_discovered_count,
        "last_duplicate_count": duplicate_count,
        "last_reached_known_region": discovered_count > 0 and new_discovered_count == 0,
        "last_completed": completed,
    }
    progress_state["extractor_cursor"] = scan_meta.get("continuation_cursor")
    if session_mode:
        source = get_source(source_id)
        current_state = source.get("cursor_state") if source and isinstance(source.get("cursor_state"), dict) else {}
        progress_state = update_session_progress_state(current_state, session_mode, progress_state, completed)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update archive_sources
                set cursor_state = cursor_state || %s,
                    status = case when %s and %s then 'completed' else status end,
                    updated_at = now()
                where id = %s
                returning cursor_state
                """,
                (Jsonb(progress_state), completed, session_mode in {None, "history"}, source_id),
            )
            cursor_state = CursorStateRow.model_validate(dict(cur.fetchone())).cursor_state
        conn.commit()
    return cursor_state


def parse_gallery_dl_records(stdout: str, source_url: str) -> list[dict[str, Any]]:
    """把 gallery-dl 的事件流合并成“每条 tweet 一行”的规范记录。"""

    text = stdout.strip()
    if not text:
        return []
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return []
    rows: dict[str, dict[str, Any]] = {}
    for event in payload if isinstance(payload, list) else []:
        if not isinstance(event, list) or len(event) < 2:
            continue
        metadata = event[1] if isinstance(event[1], dict) else event[2] if len(event) > 2 and isinstance(event[2], dict) else None
        if not metadata:
            continue
        tweet_id = str(metadata.get("tweet_id") or metadata.get("conversation_id") or "")
        if not tweet_id.isdigit():
            continue
        author = metadata.get("author") if isinstance(metadata.get("author"), dict) else {}
        username = str(author.get("name") or metadata.get("username") or "").strip() or None
        if not username:
            username = infer_author_username("profile", source_url)
        is_media_event = event[0] == 3 if event else False
        media_type = normalize_gallery_media_type(metadata.get("type"))
        media_url = event[1] if is_media_event and len(event) > 1 and isinstance(event[1], str) else None
        previous = rows.get(tweet_id)
        previous_media_items = list(previous.get("media_items", [])) if previous else []
        if is_media_event:
            # gallery-dl 会为每个媒体资产单独产出事件，因此这里要逐步合并
            # 回 tweet 级别的一条记录。
            previous_media_items.append(
                {
                    "type": media_type or "media",
                    "url": media_url,
                }
            )
        media_types = sorted({str(item.get("type") or "media") for item in previous_media_items})
        next_row = {
            "tweet_id": tweet_id,
            "url": f"https://x.com/{username or 'i'}/status/{tweet_id}",
            "author_username": username,
            "author_display_name": author.get("nick") if isinstance(author, dict) else None,
            "published_at": metadata.get("date"),
            "text": metadata.get("content"),
            "source_url": source_url,
            "collected_at": None,
            "media_count": len(previous_media_items),
            "media_types": media_types,
            "has_photo": "photo" in media_types,
            "has_video": "video" in media_types,
            "media_items": previous_media_items,
            "raw_import": metadata,
        }
        if tweet_id in rows:
            rows[tweet_id] = {
                **next_row,
                **{
                    key: value
                    for key, value in rows[tweet_id].items()
                    if value not in (None, "") and key not in {"media_count", "media_types", "has_photo", "has_video", "media_items"}
                },
                "media_count": len(previous_media_items),
                "media_types": media_types,
                "has_photo": "photo" in media_types,
                "has_video": "video" in media_types,
                "media_items": previous_media_items,
                "raw_import": metadata,
            }
        else:
            rows[tweet_id] = next_row
    records = list(rows.values())
    if is_media_scan_url(source_url):
        return [record for record in records if int(record.get("media_count") or 0) > 0]
    return records


def is_media_scan_url(source_url: str) -> bool:
    """判断来源 URL 是否指向专门的媒体时间线。"""

    return urlparse(source_url).path.rstrip("/").endswith("/media")


def normalize_gallery_media_type(value: object) -> str | None:
    """把 gallery-dl 的媒体类型规范到应用内部的 photo/video 词汇。"""

    media_type = str(value or "").strip().lower()
    if media_type in {"photo", "image"}:
        return "photo"
    if media_type in {"video", "animated_gif", "gif"}:
        return "video"
    return media_type or None


def build_gallery_dl_scan_url(source_type: str, source_url: str) -> str:
    """把来源类型映射成 gallery-dl 需要访问的目标 URL。"""

    parsed = urlparse(source_url)
    parts = [part for part in parsed.path.split("/") if part]
    if source_type == "profile" and len(parts) == 1:
        return f"{parsed.scheme}://{parsed.netloc}/{parts[0]}/timeline"
    if source_type == "user_media" and len(parts) == 1:
        return f"{parsed.scheme}://{parsed.netloc}/{parts[0]}/media"
    return source_url


def mark_source_scan_result(
    source_id: int,
    error_category: str | None = None,
    error_message: str | None = None,
) -> None:
    """把最近一次扫描结果摘要写回来源记录。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update archive_sources
                set last_scan_at = now(),
                    error_category = %s,
                    error_message = %s,
                    updated_at = now()
                where id = %s
                """,
                (error_category, error_message, source_id),
            )
        conn.commit()


def heartbeat_source_scan_run(scan_run_id: int, worker_id: str) -> bool:
    """为运行中的来源扫描续租。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update source_scan_runs
                set lease_expires_at = now() + make_interval(secs => %s)
                where id = %s
                  and worker_id = %s
                  and status in ('running', 'waiting_downloads')
                """,
                (LEASE_SECONDS, scan_run_id, worker_id),
            )
            updated = cur.rowcount
        conn.commit()
    return updated == 1


def ensure_source_scan_lease(scan_run_id: int, worker_id: str | None) -> None:
    """如果当前 worker 已不再拥有该扫描租约，则抛出异常。"""

    if worker_id is not None and not heartbeat_source_scan_run(scan_run_id, worker_id):
        raise WorkerLeaseLost("source_scan_lease_lost")


def record_source_discoveries(
    source_id: int,
    records: list[dict[str, Any]],
    mark_scanned: bool = False,
) -> dict[str, int]:
    """对来源发现结果做 upsert，并刷新来源级聚合统计。"""

    source = get_source(source_id)
    if source is None:
        raise ValueError("source_not_found")
    if not records:
        raise ValueError("records_required")
    source_url = str(source.get("source_url") or "")
    source_type = str(source.get("source_type") or "manual")
    normalized_records = [
        {
            **record,
            "source_type": source_type,
            "source_url": record.get("source_url") or source_url,
        }
        for record in records
    ]
    tweet_ids = [extract_tweet_id(str(record.get("url", ""))) for record in normalized_records]
    unique_tweet_ids = list(dict.fromkeys(tweet_ids))
    upsert_tweets(normalized_records)
    inserted = 0
    with connect() as conn:
        with conn.cursor() as cur:
            for record, tweet_id in zip(normalized_records, tweet_ids, strict=True):
                cur.execute(
                    "select raw_payload from source_discovered_tweets where source_id = %s and tweet_id = %s",
                    (source_id, tweet_id),
                )
                existing_row = cur.fetchone()
                existing = (
                    RawPayloadRow.model_validate(dict(existing_row))
                    if existing_row
                    else None
                )
                # 重扫同一条 tweet 时，可能拿到更多媒体项或更完整元数据，
                # 因此这里做合并而不是直接覆盖。
                payload = merge_discovery_payload(existing.raw_payload if existing else None, record)
                cur.execute(
                    """
                    insert into source_discovered_tweets (
                        source_id, tweet_id, raw_payload
                    )
                    values (%s, %s, %s)
                    on conflict (source_id, tweet_id) do update set
                        raw_payload = excluded.raw_payload
                    returning (xmax = 0) as inserted
                    """,
                    (source_id, tweet_id, Jsonb(payload)),
                )
                if InsertedFlagRow.model_validate(dict(cur.fetchone())).inserted:
                    inserted += 1
            cur.execute(
                """
                update archive_sources
                set discovered_count = (
                      select count(*)::int from source_discovered_tweets where source_id = %s
                    ),
                    last_seen_tweet_id = %s,
                    newest_seen_tweet_id = case
                      when newest_seen_tweet_id is null or %s::numeric > newest_seen_tweet_id::numeric then %s
                      else newest_seen_tweet_id
                    end,
                    oldest_seen_tweet_id = case
                      when oldest_seen_tweet_id is null or %s::numeric < oldest_seen_tweet_id::numeric then %s
                      else oldest_seen_tweet_id
                    end,
                    last_scan_at = case when %s then now() else last_scan_at end,
                    error_category = null,
                    error_message = null,
                    updated_at = now()
                where id = %s
                """,
                (
                    source_id,
                    unique_tweet_ids[-1],
                    unique_tweet_ids[0],
                    unique_tweet_ids[0],
                    unique_tweet_ids[-1],
                    unique_tweet_ids[-1],
                    mark_scanned,
                    source_id,
                ),
            )
        conn.commit()
    result = {
        "discovered_count": len(unique_tweet_ids),
        "new_discovered_count": inserted,
        "duplicate_count": max(len(unique_tweet_ids) - inserted, 0),
    }
    publish_event("source_scans", "source.scan.discovered", {"source_id": source_id, **result})
    return result


def merge_discovery_payload(existing: dict[str, Any] | None, current: dict[str, Any]) -> dict[str, Any]:
    """合并两份发现载荷，并按 type/url 去重媒体项。"""

    if not existing:
        return current
    items: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for item in [*(existing.get("media_items") or []), *(current.get("media_items") or [])]:
        if not isinstance(item, dict):
            continue
        key = (str(item.get("type") or "media"), str(item.get("url") or ""))
        if key in seen:
            continue
        seen.add(key)
        items.append(item)
    media_types = sorted({str(item.get("type") or "media") for item in items})
    return {
        **existing,
        **current,
        "media_items": items,
        "media_count": len(items),
        "media_types": media_types,
        "has_photo": "photo" in media_types,
        "has_video": "video" in media_types,
    }


def submit_source_records(source_id: int, records: list[dict[str, Any]]) -> dict[str, object]:
    """保存临时来源记录，并立刻提交到下载队列。"""

    record_source_discoveries(source_id, records)
    tweet_ids = [extract_tweet_id(str(record.get("url", ""))) for record in records]
    return submit_discovered_tweets(source_id, tweet_ids=list(dict.fromkeys(tweet_ids)))


def submit_source_downloads(
    source_id: int,
    scope: str,
    tweet_ids: list[str] | None = None,
    limit: int | None = None,
    media_type: str | None = None,
) -> dict[str, object]:
    """按指定范围把某个来源发现到的推文加入下载队列。"""

    source = get_source(source_id)
    if source is None:
        raise ValueError("source_not_found")
    normalized_scope = scope.strip().lower()
    if normalized_scope not in {
        "selected",
        "all_unsubmitted",
        "failed",
        "download_missing",
        "retry_failed",
        "redownload_filter",
        "current_filter",
    }:
        raise ValueError("invalid_source_download_scope")
    normalized_media_type = normalize_discovery_media_type(media_type)
    normalized_tweet_ids = list(dict.fromkeys(str(item).strip() for item in (tweet_ids or []) if str(item).strip()))
    if normalized_scope == "selected" and not normalized_tweet_ids:
        raise ValueError("tweet_ids_required")
    retry_scope = normalized_scope in {"failed", "retry_failed"}
    if retry_scope:
        retry_result = retry_source_failed_items(
            source_id,
            source,
            tweet_ids=normalized_tweet_ids or None,
            limit=limit,
            media_type=normalized_media_type,
        )
        if retry_result["submitted_count"]:
            return retry_result
    rows = fetch_source_download_candidates(
        source_id,
        normalized_scope,
        tweet_ids=normalized_tweet_ids or None,
        limit=limit,
        media_type=normalized_media_type,
    )
    if not rows:
        return build_empty_source_download_submission(source_id, normalized_scope, source, media_type=normalized_media_type)
    records = [
        {
            "url": row["url"],
            "author_username": row.get("author_username"),
            "author_display_name": row.get("author_display_name"),
            "published_at": row.get("published_at"),
            "text": row.get("text"),
            "source_type": row.get("source_type"),
            "source_url": row.get("source_url"),
            "collected_at": row.get("collected_at"),
        }
        for row in rows
    ]
    source_url = str(source.get("source_url") or "")
    submission = submit_archive_batch(records, "source_download", input_path=source_url, source_id=source_id)
    run_id = int(submission["run_id"])
    submitted_tweet_ids = [str(row["tweet_id"]) for row in rows]
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update source_discovered_tweets
                set archive_run_id = coalesce(archive_run_id, %s)
                where source_id = %s and tweet_id = any(%s)
                """,
                (run_id, source_id, submitted_tweet_ids),
            )
            cur.execute(
                """
                update archive_sources
                set submitted_count = (
                      select count(*)::int
                      from source_discovered_tweets
                      where source_id = %s and archive_run_id is not null
                    ),
                    updated_at = now()
                where id = %s
                """,
                (source_id, source_id),
            )
        conn.commit()
    result = {**submission, "source_id": source_id, "submitted_count": len(submitted_tweet_ids)}
    publish_event(
        "source_scans",
        "source.download.submitted",
        {"source_id": source_id, "run_id": run_id, "submitted_count": len(submitted_tweet_ids)},
    )
    return result


def retry_source_failed_items(
    source_id: int,
    source: dict[str, object],
    tweet_ids: list[str] | None = None,
    limit: int | None = None,
    media_type: str | None = None,
) -> dict[str, object]:
    """直接重开 failed_retryable 条目，而不是新建一个运行。"""

    normalized_media_type = normalize_discovery_media_type(media_type)
    source_url = str(source.get("source_url") or "")
    with connect() as conn:
        with conn.cursor() as cur:
            filters = ["r.source_id = %s", "i.status = 'failed_retryable'"]
            params: list[object] = [source_id]
            discovery_join = ""
            if normalized_media_type:
                discovery_join = """
                join source_discovered_tweets d
                  on d.source_id = r.source_id
                 and d.tweet_id = i.tweet_id
                """
                filters.append("d.raw_payload->'media_types' ? %s")
                params.append(normalized_media_type)
            if tweet_ids:
                filters.append("i.tweet_id = any(%s)")
                params.append(tweet_ids)
            limit_sql = ""
            if limit:
                limit_sql = "limit %s"
                params.append(limit)
            cur.execute(
                f"""
                select i.id, i.archive_run_id, i.tweet_id
                from archive_run_items i
                join archive_runs r on r.id = i.archive_run_id
                {discovery_join}
                where {" and ".join(filters)}
                order by i.updated_at asc, i.id asc
                {limit_sql}
                for update
                """,
                tuple(params),
            )
            rows = [dict(row) for row in cur.fetchall()]
            if not rows:
                return build_empty_source_download_submission(
                    source_id,
                    "failed",
                    source,
                    media_type=normalized_media_type,
                )
            run_ids = sorted({int(row["archive_run_id"]) for row in rows})
            affected_tweet_ids = [str(row["tweet_id"]) for row in rows]
            for run_id in run_ids:
                blocked_by_run_id = find_source_retry_blocker(cur, source_id, run_id)
                run_status = "blocked" if blocked_by_run_id else "queued"
                item_status = "blocked" if blocked_by_run_id else "pending"
                cur.execute(
                    """
                    update archive_run_items
                    set status = %s,
                        cancel_requested = false,
                        worker_id = null,
                        lease_expires_at = null,
                        next_attempt_at = null,
                        error_category = null,
                        error_message = null,
                        progress_message = '等待重试',
                        last_progress_at = now(),
                        updated_at = now()
                    where archive_run_id = %s
                      and tweet_id = any(%s)
                      and status = 'failed_retryable'
                    """,
                    (item_status, run_id, affected_tweet_ids),
                )
                cur.execute(
                    """
                    update archive_runs
                    set status = %s,
                        blocked_by_run_id = %s,
                        finished_at = null
                    where id = %s
                    """,
                    (run_status, blocked_by_run_id, run_id),
                )
            cur.execute(
                """
                update tweets
                set download_status = 'pending',
                    last_error = null,
                    updated_at = now()
                where tweet_id = any(%s)
                """,
                (affected_tweet_ids,),
            )
        conn.commit()
    tasks = {
        "queued_count": len(affected_tweet_ids),
        "blocked_count": 0,
        "skipped_verified_count": 0,
        "linked_pending_count": 0,
        "linked_active_count": 0,
        "skipped_completed_count": 0,
        "verified_count": 0,
        "failed_count": 0,
        "cancelled_count": 0,
    }
    result = {
        "run_id": run_ids[0],
        "status": "queued",
        "source_id": source_id,
        "blocked_by_run_id": None,
        "input": {
            "scope": "failed",
            "source_id": source_id,
            "source_url": source_url,
            "media_type": normalized_media_type,
            "input_record_count": len(affected_tweet_ids),
            "unique_tweet_count": len(affected_tweet_ids),
            "duplicate_input_count": 0,
        },
        "tasks": tasks,
        "submitted_count": len(affected_tweet_ids),
    }
    publish_event(
        "source_scans",
        "source.download.submitted",
        {"source_id": source_id, "run_id": run_ids[0], "submitted_count": len(affected_tweet_ids), "scope": "failed"},
    )
    return result


def find_source_retry_blocker(cur, source_id: int, run_id: int) -> int | None:
    """返回阻塞当前重试恢复的同 source 其他活动运行。"""

    cur.execute(
        """
        select id
        from archive_runs
        where source_id = %s
          and id <> %s
          and status in ('queued', 'running', 'paused')
        order by started_at asc, id asc
        limit 1
        for update skip locked
        """,
        (source_id, run_id),
    )
    row = cur.fetchone()
    return int(row["id"]) if row else None


def build_empty_source_download_submission(
    source_id: int,
    scope: str,
    source: dict[str, object],
    media_type: str | None = None,
) -> dict[str, object]:
    """构造“没有任何 tweet 命中当前范围”时的空响应结构。"""

    input_summary = {
        "scope": scope,
        "source_id": source_id,
        "source_url": str(source.get("source_url") or ""),
        "media_type": media_type,
        "input_record_count": 0,
        "unique_tweet_count": 0,
        "duplicate_input_count": 0,
    }
    tasks = {
        "queued_count": 0,
        "blocked_count": 0,
        "skipped_verified_count": 0,
        "linked_pending_count": 0,
        "linked_active_count": 0,
        "skipped_completed_count": 0,
        "verified_count": 0,
        "failed_count": 0,
        "cancelled_count": 0,
    }
    return {
        "run_id": None,
        "status": "completed",
        "source_id": source_id,
        "blocked_by_run_id": None,
        "input": input_summary,
        "tasks": tasks,
        "submitted_count": 0,
    }


def submit_discovered_tweets(
    source_id: int,
    limit: int | None = None,
    tweet_ids: list[str] | None = None,
) -> dict[str, object]:
    """``submit_source_downloads`` 的便捷包装。"""

    return submit_source_downloads(source_id, "selected" if tweet_ids else "all_unsubmitted", tweet_ids=tweet_ids, limit=limit)


def get_source_downloads(source_id: int, include_deleted: bool = False) -> dict[str, object]:
    """返回某个来源的 active、paused、blocked 与整体下载状态。"""

    if get_source(source_id, include_deleted=include_deleted) is None:
        raise ValueError("source_not_found")
    runs = list_runs(limit=20, source_id=source_id)
    active = next((run for run in runs if run.status in {"queued", "running"}), None)
    active_detail = get_run_detail(int(active.id)) if active else None
    active_counts = build_source_download_counts(
        count_run_items(int(active.id)) if active else {}
    )
    paused_runs = [dict(run) for run in runs if run.status == "paused"]
    blocked_runs = [dict(run) for run in runs if run.status == "blocked"]
    current_tweet_id = None
    with connect() as conn:
        with conn.cursor() as cur:
            if active:
                current_tweet_sql, current_tweet_params = compile_query(
                    select(download_jobs.c.current_tweet_id)
                    .where(
                        download_jobs.c.archive_run_id == bindparam("active_run_id", int(active.id)),
                        download_jobs.c.current_tweet_id.is_not(None),
                    )
                    .order_by(download_jobs.c.last_progress_at.desc().nulls_last(), download_jobs.c.id.desc())
                    .limit(1)
                )
                cur.execute(current_tweet_sql, current_tweet_params)
                current_tweet_row = cur.fetchone()
                current_tweet_id = str(current_tweet_row["current_tweet_id"]) if current_tweet_row else None
            cur.execute(
                """
                select i.status, count(*)::int as count
                from archive_run_items i
                join archive_runs r on r.id = i.archive_run_id
                where r.source_id = %s
                group by i.status
                """,
                (source_id,),
            )
            status_counts = {str(row["status"]): int(row["count"]) for row in cur.fetchall()}
            cur.execute(
                """
                select coalesce(sum(i.downloaded_bytes), 0)::bigint as downloaded_bytes,
                       nullif(sum(i.total_bytes), 0)::bigint as total_bytes,
                       nullif(sum(i.speed_bps) filter (where i.status = 'processing'), 0)::bigint as speed_bps
                from archive_run_items i
                where i.archive_run_id = %s
                """,
                (int(active.id) if active else None,),
            )
            progress = dict(cur.fetchone())
    return {
        "source_id": source_id,
        "current_tweet_id": current_tweet_id,
        "active_run": active_detail,
        "active_counts": active_counts,
        "paused_runs": paused_runs,
        "blocked_runs": blocked_runs,
        "recent_runs": [dict(run) for run in runs],
        "pending_count": status_counts.get("pending", 0),
        "blocked_count": status_counts.get("blocked", 0),
        "processing_count": status_counts.get("processing", 0),
        "paused_count": sum(int((run.get("result") or {}).get("tasks", {}).get("queued_count", 0)) for run in paused_runs),
        "failed_count": status_counts.get("failed_retryable", 0) + status_counts.get("failed_permanent", 0),
        "completed_count": status_counts.get("verified", 0) + status_counts.get("skipped_verified", 0),
        "cancelled_count": status_counts.get("cancelled", 0),
        "downloaded_bytes": int(progress.get("downloaded_bytes") or 0),
        "total_bytes": progress.get("total_bytes"),
        "speed_bps": progress.get("speed_bps"),
    }


def build_source_download_counts(task_counts: dict[str, int]) -> dict[str, int]:
    """把运行任务计数转换成来源下载摘要结构。"""

    counts = {
        "pending_count": int(task_counts.get("pending_count", 0)),
        "blocked_count": int(task_counts.get("blocked_item_count", 0)),
        "processing_count": int(task_counts.get("processing_count", 0)),
        "failed_retryable_count": int(task_counts.get("failed_retryable_count", 0)),
        "verified_count": int(task_counts.get("verified_count", 0)),
        "skipped_verified_count": int(task_counts.get("skipped_verified_count", 0)),
        "linked_pending_count": int(task_counts.get("linked_pending_count", 0)),
        "failed_permanent_count": int(task_counts.get("failed_count", 0)),
        "cancelled_count": int(task_counts.get("cancelled_count", 0)),
    }
    counts["total_count"] = sum(counts.values())
    counts["settled_count"] = sum(
        counts[key]
        for key in (
            "verified_count",
            "skipped_verified_count",
            "linked_pending_count",
            "failed_permanent_count",
            "cancelled_count",
        )
    )
    return counts


def fetch_unsubmitted_discoveries(
    source_id: int,
    limit: int | None = None,
    tweet_ids: list[str] | None = None,
) -> list[TweetRow]:
    """读取尚未关联到任何运行的已发现推文。"""

    sql, params = build_unsubmitted_discoveries_query(source_id, limit=limit, tweet_ids=tweet_ids)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [TweetRow.model_validate(dict(row)) for row in cur.fetchall()]


def fetch_source_download_candidates(
    source_id: int,
    scope: str,
    tweet_ids: list[str] | None = None,
    limit: int | None = None,
    media_type: str | None = None,
) -> list[TweetRow]:
    """读取可用于来源驱动下载提交的推文记录。"""

    sql, params = build_source_download_candidates_query(
        source_id,
        scope,
        tweet_ids=tweet_ids,
        limit=limit,
        media_type=media_type,
    )
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [TweetRow.model_validate(dict(row)) for row in cur.fetchall()]


def build_source_download_candidates_query(
    source_id: int,
    scope: str,
    tweet_ids: list[str] | None = None,
    limit: int | None = None,
    media_type: str | None = None,
) -> tuple[str, dict[str, object]]:
    """构造来源下载提交各类范围使用的查询。"""

    normalized_media_type = normalize_discovery_media_type(media_type)
    statement = (
        select(tweets)
        .select_from(
            source_discovered_tweets.join(
                tweets,
                tweets.c.tweet_id == source_discovered_tweets.c.tweet_id,
            )
        )
        .where(source_discovered_tweets.c.source_id == bindparam("source_id", source_id))
        .order_by(source_discovered_tweets.c.discovered_at.desc(), source_discovered_tweets.c.id.desc())
    )
    if scope == "all_unsubmitted":
        statement = statement.where(source_discovered_tweets.c.archive_run_id.is_(None))
    elif scope in {"failed", "retry_failed"}:
        statement = statement.where(tweets.c.download_status.in_(("failed_retryable", "corrupt")))
    elif scope == "selected":
        statement = statement.where(source_discovered_tweets.c.tweet_id.in_(tweet_ids or []))
    elif scope == "download_missing":
        active_item_exists = (
            select(archive_run_items.c.id)
            .select_from(archive_run_items.join(archive_runs, archive_runs.c.id == archive_run_items.c.archive_run_id))
            .where(
                archive_runs.c.source_id == bindparam("source_id", source_id),
                archive_run_items.c.tweet_id == source_discovered_tweets.c.tweet_id,
                archive_run_items.c.status.in_(("pending", "blocked", "processing")),
            )
            .exists()
        )
        statement = statement.where(
            ~active_item_exists,
            or_(
                tweets.c.download_status.is_(None),
                tweets.c.download_status.not_in(("verified", "downloaded", "skipped")),
            ),
        )
    elif scope in {"redownload_filter", "current_filter"}:
        pass
    if normalized_media_type:
        statement = statement.where(
            source_discovered_tweets.c.raw_payload["media_types"].op("?")(bindparam("media_type", normalized_media_type))
        )
    if tweet_ids is not None and scope != "selected":
        statement = statement.where(source_discovered_tweets.c.tweet_id.in_(tweet_ids))
    if limit:
        statement = statement.limit(bindparam("limit", limit))
    return compile_query(statement)


def build_unsubmitted_discoveries_query(
    source_id: int,
    limit: int | None = None,
    tweet_ids: list[str] | None = None,
) -> tuple[str, dict[str, object]]:
    """构造读取来源待提交发现结果的查询。"""

    statement = (
        select(tweets)
        .select_from(
            source_discovered_tweets.join(
                tweets,
                tweets.c.tweet_id == source_discovered_tweets.c.tweet_id,
            )
        )
        .where(
            source_discovered_tweets.c.source_id == bindparam("source_id", source_id),
            source_discovered_tweets.c.archive_run_id.is_(None),
        )
        .order_by(
            source_discovered_tweets.c.discovered_at.asc(),
            source_discovered_tweets.c.id.asc(),
        )
    )
    if tweet_ids is not None:
        statement = statement.where(source_discovered_tweets.c.tweet_id.in_(tweet_ids))
    if limit:
        statement = statement.limit(bindparam("limit", limit))
    return compile_query(statement)


def classify_source_error(stderr: str | None) -> str:
    """把 gallery-dl 的 stderr 映射成共享的 X 错误类别。"""

    return category_value(classify_x_error(stderr, no_output_hint=False)) or ErrorCategory.UNKNOWN.value


def normalize_source_type(source_type: str) -> str:
    """校验并规范化来源类型输入。"""

    value = source_type.strip().lower()
    if value not in VALID_SOURCE_TYPES:
        raise ValueError(f"invalid_source_type: {source_type}")
    return value


def normalize_source_status(status: str) -> str:
    """校验并规范化来源状态输入。"""

    value = status.strip().lower()
    if value not in VALID_SOURCE_STATUSES:
        raise ValueError(f"invalid_source_status: {status}")
    return value


def normalize_source_url(source_url: str) -> str:
    """校验来源 URL 是否指向受支持的 X/Twitter 域名。"""

    value = source_url.strip()
    parsed = urlparse(value)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme not in {"https", "http"} or hostname not in {
        "x.com",
        "www.x.com",
        "twitter.com",
        "www.twitter.com",
    }:
        raise ValueError("invalid_source_url")
    path = parsed.path.rstrip("/")
    return urlunparse(("https", "x.com", path, parsed.params, parsed.query, ""))


def infer_author_username(source_type: str, source_url: str) -> str | None:
    """在可能的情况下，从 profile 类 URL 推断来源归属用户名。"""

    if source_type not in {"profile", "user_media", "likes"}:
        return None
    path_parts = [part for part in urlparse(source_url).path.split("/") if part]
    if not path_parts:
        return None
    username = path_parts[0]
    if username in {"home", "search", "bookmarks", "i"}:
        return None
    return username


def log_source_scan_event(event: str, **details: object) -> None:
    """通过 Python logger 输出结构化来源扫描事件。"""

    logger.info("来源扫描事件：%s", event, extra={"event": event, "details": details})
