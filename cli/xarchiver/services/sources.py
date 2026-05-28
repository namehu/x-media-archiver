from __future__ import annotations

import json
import logging
import random
import re
import shutil
import subprocess
from typing import Any
from urllib.parse import urlparse

from psycopg.types.json import Jsonb

from xarchiver.config import Settings, get_settings
from xarchiver.core.errors import ErrorCategory, category_value, classify_x_error
from xarchiver.core.events import publish_event
from xarchiver.db import connect
from xarchiver.importer import extract_tweet_id, upsert_tweets
from xarchiver.services.queue import has_pending_download_work, submit_archive_batch

VALID_SOURCE_TYPES = {"profile", "user_media", "likes", "bookmarks", "search", "manual"}
VALID_SOURCE_STATUSES = {"active", "paused", "completed", "failed"}
VALID_SCAN_TRIGGERS = {"history_worker", "manual_next", "latest_refresh"}
logger = logging.getLogger(__name__)


def create_source(
    source_type: str,
    source_url: str,
    label: str | None = None,
    author_username: str | None = None,
) -> dict[str, object]:
    source_type = normalize_source_type(source_type)
    source_url = normalize_source_url(source_url)
    author_username = author_username or infer_author_username(source_type, source_url)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into archive_sources (source_type, source_url, label, author_username)
                values (%s, %s, %s, %s)
                returning *
                """,
                (source_type, source_url, label, author_username),
            )
            row = dict(cur.fetchone())
        conn.commit()
    publish_event(
        "sources",
        "source.created",
        {"source_id": int(row["id"]), "source_type": source_type, "source_url": source_url},
    )
    return row


def list_sources(
    status: str | None = None,
    source_type: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, object]]:
    where, params = build_source_filters(status=status, source_type=source_type)
    params.extend([limit, offset])
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                select s.*,
                       count(d.id)::int as discovered_tweet_count,
                       count(d.id) filter (where d.archive_run_id is null)::int as unsubmitted_tweet_count,
                       coalesce(sum(coalesce((d.raw_payload->>'media_count')::int, 0)), 0)::int as discovered_media_count,
                       max(d.discovered_at) as latest_discovered_at
                from archive_sources s
                left join source_discovered_tweets d on d.source_id = s.id
                {where}
                group by s.id
                order by s.updated_at desc, s.id desc
                limit %s offset %s
                """,
                tuple(params),
            )
            return [dict(row) for row in cur.fetchall()]


def list_sources_page(
    status: str | None = None,
    source_type: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, object]:
    rows = list_sources(status=status, source_type=source_type, limit=limit, offset=offset)
    total_count = count_sources(status=status, source_type=source_type)
    return {"rows": rows, "count": len(rows), "total_count": total_count, "limit": limit, "offset": offset}


def count_sources(
    status: str | None = None,
    source_type: str | None = None,
) -> int:
    where, params = build_source_filters(status=status, source_type=source_type)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                select count(*)::int as count
                from archive_sources s
                {where}
                """,
                tuple(params),
            )
            return int(cur.fetchone()["count"])


def build_source_filters(
    status: str | None = None,
    source_type: str | None = None,
) -> tuple[str, list[object]]:
    filters: list[str] = []
    params: list[object] = []
    if status:
        filters.append("s.status = %s")
        params.append(normalize_source_status(status))
    if source_type:
        filters.append("s.source_type = %s")
        params.append(normalize_source_type(source_type))
    where = f"where {' and '.join(filters)}" if filters else ""
    return where, params


def get_source(source_id: int) -> dict[str, object] | None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select s.*,
                       count(d.id)::int as discovered_tweet_count,
                       count(d.id) filter (where d.archive_run_id is null)::int as unsubmitted_tweet_count,
                       coalesce(sum(coalesce((d.raw_payload->>'media_count')::int, 0)), 0)::int as discovered_media_count,
                       max(d.discovered_at) as latest_discovered_at
                from archive_sources s
                left join source_discovered_tweets d on d.source_id = s.id
                where s.id = %s
                group by s.id
                """,
                (source_id,),
            )
            source = cur.fetchone()
            if source is None:
                return None
            cur.execute(
                """
                select d.id, d.tweet_id, d.archive_run_id, d.discovered_at, t.download_status,
                       t.author_username, t.text, d.raw_payload
                from source_discovered_tweets d
                join tweets t on t.tweet_id = d.tweet_id
                where d.source_id = %s
                order by d.discovered_at desc, d.id desc
                limit 100
                """,
                (source_id,),
            )
            discovered = [dict(row) for row in cur.fetchall()]
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
            scan_summary = dict(cur.fetchone())
            cur.execute(
                """
                select id, trigger_type, status, range_start, range_end, requested_limit,
                       cursor_before, cursor_after, discovered_tweet_count, new_tweet_count,
                       duplicate_tweet_count, discovered_media_count, error_category,
                       error_message, started_at, finished_at, created_at
                from source_scan_runs
                where source_id = %s
                order by created_at desc, id desc
                limit 20
                """,
                (source_id,),
            )
            scan_runs = [dict(row) for row in cur.fetchall()]
    return {**dict(source), "discovered": discovered, "scan_summary": scan_summary, "scan_runs": scan_runs}


def update_source_status(source_id: int, status: str) -> dict[str, object]:
    status = normalize_source_status(status)
    source = get_source(source_id)
    if source is None:
        raise ValueError("source_not_found")
    cursor_state = source.get("cursor_state") if isinstance(source.get("cursor_state"), dict) else {}
    automation_enabled = bool(cursor_state.get("automation_enabled"))
    if automation_enabled and status == "paused":
        cursor_state = {**cursor_state, "automation_state": "paused"}
    elif automation_enabled and status == "active":
        cursor_state = {**cursor_state, "automation_state": "running"}
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
            row = cur.fetchone()
        conn.commit()
    publish_event("sources", "source.status_changed", {"source_id": source_id, "status": status})
    return dict(row)


def start_source_history_scan(source_id: int, limit: int = 20, restart: bool = False) -> dict[str, object]:
    source = get_source(source_id)
    if source is None:
        raise ValueError("source_not_found")
    if str(source.get("source_type")) not in {"profile", "user_media"}:
        raise ValueError("source_scan_not_supported")
    if limit < 1:
        raise ValueError("scan_limit_required")
    cursor_state = source.get("cursor_state") if isinstance(source.get("cursor_state"), dict) else {}
    cursor_state = {
        **cursor_state,
        "automation_enabled": True,
        "automation_state": "running",
        "automation_limit": limit,
        "last_completed": False,
    }
    if restart:
        cursor_state["next_start_index"] = 1
        cursor_state.pop("extractor_cursor", None)
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
    publish_event("source_scans", "source.history_scan.started", {"source_id": source_id, "limit": limit, "restart": restart})
    return get_source(source_id) or {}


def stop_source_history_scan(source_id: int) -> dict[str, object]:
    source = get_source(source_id)
    if source is None:
        raise ValueError("source_not_found")
    cursor_state = source.get("cursor_state") if isinstance(source.get("cursor_state"), dict) else {}
    cursor_state = {**cursor_state, "automation_enabled": False, "automation_state": "stopped"}
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update archive_sources
                set cursor_state = %s, next_scan_at = null, updated_at = now()
                where id = %s
                """,
                (Jsonb(cursor_state), source_id),
            )
        conn.commit()
    publish_event("source_scans", "source.history_scan.stopped", {"source_id": source_id})
    return get_source(source_id) or {}


def process_next_source_history_scan(settings: Settings) -> dict[str, object] | None:
    source = fetch_due_history_source()
    if source is None:
        return None
    source_id = int(source["id"])
    cursor_state = source.get("cursor_state") if isinstance(source.get("cursor_state"), dict) else {}
    limit = parse_positive_int(cursor_state.get("automation_limit"), settings.source_scan_batch_size)
    try:
        downloads_pending = has_pending_download_work()
    except Exception as exc:
        record_source_scan_failure(source_id, cursor_state, limit, "history_worker", exc)
        schedule_next_history_scan(source_id, settings, "retry_wait")
        raise
    if downloads_pending:
        record_waiting_downloads_scan(source_id, cursor_state, limit)
        schedule_next_history_scan(source_id, settings, "waiting_downloads")
        return {"source_id": source_id, "deferred": "download_queue_active"}
    try:
        result = scan_source(source_id, limit, settings=settings, trigger_type="history_worker")
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
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update source_scan_runs
                set status = 'failed',
                    error_category = 'interrupted',
                    error_message = 'API stopped before this scan batch finished.',
                    finished_at = now()
                where status = 'running'
                """
            )
            recovered = cur.rowcount
        conn.commit()
    return recovered


def fetch_due_history_source() -> dict[str, object] | None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select *
                from archive_sources
                where status = 'active'
                  and cursor_state->>'automation_enabled' = 'true'
                  and (next_scan_at is null or next_scan_at <= now())
                order by coalesce(next_scan_at, now()), id
                limit 1
                """
            )
            row = cur.fetchone()
            return dict(row) if row else None


def schedule_next_history_scan(source_id: int, settings: Settings, state: str) -> None:
    source = get_source(source_id)
    cursor_state = source.get("cursor_state") if source and isinstance(source.get("cursor_state"), dict) else {}
    if not source or source.get("status") != "active" or not cursor_state.get("automation_enabled"):
        return
    delay = random.uniform(
        min(settings.source_scan_sleep_min_seconds, settings.source_scan_sleep_max_seconds),
        max(settings.source_scan_sleep_min_seconds, settings.source_scan_sleep_max_seconds),
    )
    update_history_scan_state(source_id, state, delay_seconds=delay)


def pause_history_scan_for_error(source_id: int, error_category: str) -> None:
    update_history_scan_state(source_id, error_category, enabled=True, status="paused")


def finish_history_scan(source_id: int) -> None:
    update_history_scan_state(source_id, "completed", enabled=False, status="completed")


def update_history_scan_state(
    source_id: int,
    state: str,
    *,
    delay_seconds: float | None = None,
    enabled: bool | None = None,
    status: str | None = None,
) -> None:
    source = get_source(source_id)
    if source is None:
        return
    cursor_state = source.get("cursor_state") if isinstance(source.get("cursor_state"), dict) else {}
    cursor_state = {**cursor_state, "automation_state": state}
    if enabled is not None:
        cursor_state["automation_enabled"] = enabled
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
) -> int:
    if trigger_type not in VALID_SCAN_TRIGGERS:
        raise ValueError("invalid_scan_trigger")
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into source_scan_runs (
                    source_id, trigger_type, status, range_start, range_end,
                    requested_limit, cursor_before, started_at
                )
                values (%s, %s, 'running', %s, %s, %s, %s, now())
                returning id
                """,
                (
                    source_id,
                    trigger_type,
                    scan_range["start"],
                    scan_range["end"],
                    scan_range["limit"],
                    Jsonb(cursor_before),
                ),
            )
            run_id = int(cur.fetchone()["id"])
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
) -> None:
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
                    finished_at = now()
                where id = %s
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
                ),
            )
        conn.commit()
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


def record_waiting_downloads_scan(source_id: int, cursor_state: dict[str, Any], limit: int) -> None:
    scan_range = build_scan_range(cursor_state, limit)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into source_scan_runs (
                    source_id, trigger_type, status, range_start, range_end,
                    requested_limit, cursor_before, cursor_after, started_at, finished_at
                )
                values (%s, 'history_worker', 'waiting_downloads', %s, %s, %s, %s, %s, now(), now())
                """,
                (
                    source_id,
                    scan_range["start"],
                    scan_range["end"],
                    scan_range["limit"],
                    Jsonb(cursor_state),
                    Jsonb(cursor_state),
                ),
            )
        conn.commit()
    publish_event(
        "source_scans",
        "source.scan.waiting_downloads",
        {"source_id": source_id, "range": scan_range, "status": "waiting_downloads"},
    )


def record_source_scan_failure(
    source_id: int,
    cursor_state: dict[str, Any],
    limit: int,
    trigger_type: str,
    error: Exception,
) -> None:
    run_id = start_source_scan_run(source_id, trigger_type, build_scan_range(cursor_state, limit), cursor_state)
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
) -> dict[str, object]:
    settings = settings or get_settings()
    source = get_source(source_id)
    if source is None:
        raise ValueError("source_not_found")
    if str(source.get("status")) == "paused":
        raise ValueError("source_paused")
    source_url = str(source.get("source_url") or "")
    source_type = str(source.get("source_type") or "")
    if source_type not in {"profile", "user_media"}:
        raise ValueError("source_scan_not_supported")
    scan_url = build_gallery_dl_scan_url(source_type, source_url)
    cursor_state = source.get("cursor_state") if isinstance(source.get("cursor_state"), dict) else {}
    scan_trigger = trigger_type or ("latest_refresh" if restart else "manual_next")
    advances_history = scan_trigger != "latest_refresh"
    scan_cursor = None if not advances_history else cursor_state.get("extractor_cursor")
    scan_range = build_scan_range(cursor_state, limit, restart=restart)
    scan_run_id = start_source_scan_run(source_id, scan_trigger, scan_range, cursor_state)
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
        records, scan_meta = discover_records_with_gallery_dl(
            scan_url,
            scan_range["start"],
            scan_range["end"],
            settings.source_scan_sleep_min_seconds,
            settings.source_scan_sleep_max_seconds,
            continuation_cursor=str(scan_cursor) if scan_cursor else None,
        )
        if not records:
            scan_succeeded = scan_meta.get("exit_code") == 0
            completed = scan_succeeded and advances_history
            cursor_after = (
                update_source_cursor(
                    source_id,
                    scan_meta,
                    scan_range,
                    discovered_count=0,
                    new_discovered_count=0,
                    completed=completed,
                )
                if advances_history
                else cursor_state
            )
            error_category = None if scan_succeeded else str(scan_meta.get("error_category") or "failed")
            error_message = (
                None if scan_succeeded else str(scan_meta.get("error_message") or "No tweets discovered for source.")
            )
            mark_source_scan_result(source_id, error_category=error_category, error_message=error_message)
            finish_source_scan_run(
                scan_run_id,
                scan_run_status(scan_meta, completed),
                cursor_after=cursor_after,
                error_category=error_category,
                error_message=error_message,
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
        result = record_source_discoveries(source_id, records, mark_scanned=True)
        completed = advances_history and is_source_scan_complete(scan_meta, scan_range, int(result["discovered_count"]))
        cursor_after = (
            update_source_cursor(
                source_id,
                scan_meta,
                scan_range,
                discovered_count=int(result["discovered_count"]),
                new_discovered_count=int(result["new_discovered_count"]),
                completed=completed,
            )
            if advances_history
            else cursor_state
        )
        mark_source_scan_result(source_id)
        finish_source_scan_run(
            scan_run_id,
            scan_run_status(scan_meta, completed),
            cursor_after=cursor_after,
            discovered_tweet_count=int(result["discovered_count"]),
            new_tweet_count=int(result["new_discovered_count"]),
            duplicate_tweet_count=int(result["duplicate_count"]),
            discovered_media_count=count_discovered_media(records),
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
    except Exception as exc:
        mark_source_scan_result(source_id, error_category="failed", error_message=str(exc))
        finish_source_scan_run(
            scan_run_id,
            "failed",
            cursor_after=cursor_state,
            error_category="failed",
            error_message=str(exc),
        )
        log_source_scan_event(
            "source.scan.failed",
            source_id=source_id,
            scan_run_id=scan_run_id,
            error_type=type(exc).__name__,
        )
        raise


def discover_records_with_gallery_dl(
    source_url: str,
    start: int,
    end: int,
    sleep_min_seconds: float = 20.0,
    sleep_max_seconds: float = 45.0,
    continuation_cursor: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, object]]:
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
    ]
    limit = end - start + 1
    command.extend(["--verbose", "-o", f"limit={limit}", "--post-range", f"1-{limit}"])
    if continuation_cursor:
        command.extend(["-o", f"cursor={continuation_cursor}"])
    command.append(source_url)
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    stderr_excerpt = result.stderr[-4000:] if result.stderr else None
    if result.returncode != 0:
        return [], {
            "exit_code": result.returncode,
            "error_category": classify_source_error(stderr_excerpt),
            "error_message": stderr_excerpt or f"gallery-dl exited with {result.returncode}",
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


def format_sleep_range(min_seconds: float, max_seconds: float) -> str:
    start = min(min_seconds, max_seconds)
    end = max(min_seconds, max_seconds)
    start_text = f"{start:g}"
    end_text = f"{end:g}"
    return start_text if start == end else f"{start_text}-{end_text}"


def build_scan_range(cursor_state: dict[str, Any], limit: int, restart: bool = False) -> dict[str, int]:
    if limit < 1:
        raise ValueError("scan_limit_required")
    start = 1 if restart else parse_positive_int(cursor_state.get("next_start_index"), default=1)
    end = start + limit - 1
    return {"start": start, "end": end, "limit": limit}


def is_source_scan_complete(scan_meta: dict[str, object], scan_range: dict[str, int], discovered_count: int) -> bool:
    if scan_meta.get("exit_code") != 0:
        return False
    return not scan_meta.get("continuation_cursor")


def extract_gallery_dl_cursor(stderr: str | None) -> str | None:
    matches = re.findall(r"Cursor:\s+(\S+)", stderr or "")
    return matches[-1] if matches else None


def scan_run_status(scan_meta: dict[str, object], completed: bool) -> str:
    if completed:
        return "completed_empty_batch" if int(scan_meta.get("raw_record_count") or 0) == 0 else "completed_end_of_source"
    category = str(scan_meta.get("error_category") or "")
    if category in {"rate_limited", "auth_required", "network_error"}:
        return category
    if scan_meta.get("exit_code") == 0:
        return "succeeded"
    return "failed"


def count_discovered_media(records: list[dict[str, Any]]) -> int:
    return sum(parse_positive_int(record.get("media_count"), 0) for record in records)


def parse_positive_int(value: object, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed >= 1 else default


def update_source_cursor(
    source_id: int,
    scan_meta: dict[str, object],
    scan_range: dict[str, int],
    discovered_count: int,
    new_discovered_count: int,
    completed: bool,
) -> dict[str, Any]:
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
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update archive_sources
                set cursor_state = cursor_state || %s,
                    status = case when %s then 'completed' else status end,
                    updated_at = now()
                where id = %s
                returning cursor_state
                """,
                (Jsonb(progress_state), completed, source_id),
            )
            cursor_state = dict(cur.fetchone()["cursor_state"])
        conn.commit()
    return cursor_state


def parse_gallery_dl_records(stdout: str, source_url: str) -> list[dict[str, Any]]:
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
    return urlparse(source_url).path.rstrip("/").endswith("/media")


def normalize_gallery_media_type(value: object) -> str | None:
    media_type = str(value or "").strip().lower()
    if media_type in {"photo", "image"}:
        return "photo"
    if media_type in {"video", "animated_gif", "gif"}:
        return "video"
    return media_type or None


def build_gallery_dl_scan_url(source_type: str, source_url: str) -> str:
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


def record_source_discoveries(
    source_id: int,
    records: list[dict[str, Any]],
    mark_scanned: bool = False,
) -> dict[str, int]:
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
                existing = cur.fetchone()
                payload = merge_discovery_payload(existing["raw_payload"] if existing else None, record)
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
                if cur.fetchone()["inserted"]:
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
    record_source_discoveries(source_id, records)
    tweet_ids = [extract_tweet_id(str(record.get("url", ""))) for record in records]
    return submit_discovered_tweets(source_id, tweet_ids=list(dict.fromkeys(tweet_ids)))


def submit_discovered_tweets(
    source_id: int,
    limit: int | None = None,
    tweet_ids: list[str] | None = None,
) -> dict[str, object]:
    source = get_source(source_id)
    if source is None:
        raise ValueError("source_not_found")
    rows = fetch_unsubmitted_discoveries(source_id, limit=limit, tweet_ids=tweet_ids)
    if not rows:
        raise ValueError("source_has_no_unsubmitted_tweets")
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
    submission = submit_archive_batch(records, "source_collector", input_path=source_url)
    run_id = int(submission["run_id"])
    submitted_tweet_ids = [str(row["tweet_id"]) for row in rows]
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update source_discovered_tweets
                set archive_run_id = %s
                where source_id = %s and tweet_id = any(%s)
                """,
                (run_id, source_id, submitted_tweet_ids),
            )
            cur.execute(
                """
                update archive_sources
                set submitted_count = submitted_count + %s,
                    updated_at = now()
                where id = %s
                """,
                (len(submitted_tweet_ids), source_id),
            )
        conn.commit()
    result = {**submission, "source_id": source_id, "submitted_count": len(submitted_tweet_ids)}
    publish_event(
        "source_scans",
        "source.discovered.submitted",
        {"source_id": source_id, "run_id": run_id, "submitted_count": len(submitted_tweet_ids)},
    )
    return result


def fetch_unsubmitted_discoveries(
    source_id: int,
    limit: int | None = None,
    tweet_ids: list[str] | None = None,
) -> list[dict[str, object]]:
    filters = ["d.source_id = %s", "d.archive_run_id is null"]
    params: list[object] = [source_id]
    if tweet_ids is not None:
        filters.append("d.tweet_id = any(%s)")
        params.append(tweet_ids)
    sql = f"""
        select t.*
        from source_discovered_tweets d
        join tweets t on t.tweet_id = d.tweet_id
        where {' and '.join(filters)}
        order by d.discovered_at asc, d.id asc
    """
    if limit:
        sql += " limit %s"
        params.append(limit)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, tuple(params))
            return [dict(row) for row in cur.fetchall()]


def classify_source_error(stderr: str | None) -> str:
    return category_value(classify_x_error(stderr, no_output_hint=False)) or ErrorCategory.UNKNOWN.value


def normalize_source_type(source_type: str) -> str:
    value = source_type.strip().lower()
    if value not in VALID_SOURCE_TYPES:
        raise ValueError(f"invalid_source_type: {source_type}")
    return value


def normalize_source_status(status: str) -> str:
    value = status.strip().lower()
    if value not in VALID_SOURCE_STATUSES:
        raise ValueError(f"invalid_source_status: {status}")
    return value


def normalize_source_url(source_url: str) -> str:
    value = source_url.strip()
    parsed = urlparse(value)
    if parsed.scheme not in {"https", "http"} or parsed.netloc.lower() not in {
        "x.com",
        "www.x.com",
        "twitter.com",
        "www.twitter.com",
    }:
        raise ValueError("invalid_source_url")
    return value


def infer_author_username(source_type: str, source_url: str) -> str | None:
    if source_type not in {"profile", "user_media"}:
        return None
    path_parts = [part for part in urlparse(source_url).path.split("/") if part]
    if not path_parts:
        return None
    username = path_parts[0]
    if username in {"home", "search", "bookmarks", "i"}:
        return None
    return username


def log_source_scan_event(event: str, **details: object) -> None:
    logger.info("Source scan event: %s", event, extra={"event": event, "details": details})
