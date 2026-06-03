from __future__ import annotations

import json
import re
import traceback
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from psycopg.types.json import Jsonb

from xarchiver.config import get_settings
from xarchiver.core.events import publish_event
from xarchiver.db import connect
from xarchiver.row_models import IdRow

VALID_LOG_LEVELS = {"debug", "info", "warning", "error", "critical"}
DEFAULT_LOG_READ_LIMIT = 200
MAX_LOG_READ_LIMIT = 1000
SENSITIVE_PATTERNS = (
    (re.compile(r"(auth_token=)[^\s;&]+", re.IGNORECASE), r"\1[redacted]"),
    (re.compile(r"(ct0=)[^\s;&]+", re.IGNORECASE), r"\1[redacted]"),
    (re.compile(r"(cookie:\s*)[^\n\r]+", re.IGNORECASE), r"\1[redacted]"),
    (re.compile(r"(postgres(?:ql)?(?:\+psycopg)?://[^:\s]+:)[^@\s]+@", re.IGNORECASE), r"\1[redacted]@"),
)


def create_operation_log_stream(
    scope_type: str,
    scope_id: int,
    log_path: str,
    metadata: dict[str, Any] | None = None,
) -> int:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into operation_log_streams (
                    scope_type, scope_id, log_path, metadata
                )
                values (%s, %s, %s, %s)
                returning id
                """,
                (scope_type, scope_id, log_path, Jsonb(metadata or {})),
            )
            stream_id = IdRow.model_validate(dict(cur.fetchone())).id
        conn.commit()
    return stream_id


def append_operation_log_entry(
    stream_id: int,
    level: str,
    component: str,
    message: str,
    *,
    raw: str | None = None,
    context: dict[str, Any] | None = None,
    exception: BaseException | None = None,
) -> dict[str, Any] | None:
    level = normalize_log_level(level)
    message = redact_sensitive_text(message).strip()
    raw = redact_sensitive_text(raw).rstrip("\n\r") if raw is not None else None
    if not message and not raw and exception is None:
        return None

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select id, scope_type, scope_id, log_path, line_count, byte_size,
                       level_counts, is_truncated
                from operation_log_streams
                where id = %s
                for update
                """,
                (stream_id,),
            )
            row = cur.fetchone()
            if row is None:
                return None
            if row["is_truncated"]:
                return None

            entry = build_log_entry(level, component, message or raw or "", raw=raw, context=context, exception=exception)
            encoded = (json.dumps(entry, ensure_ascii=False, default=str, separators=(",", ":")) + "\n").encode("utf-8")
            current_size = int(row["byte_size"] or 0)
            max_bytes = int(get_settings().operation_log_max_bytes)
            if current_size + len(encoded) > max_bytes:
                entry = build_log_entry(
                    "warning",
                    "xarchiver",
                    f"Operation log truncated after reaching {max_bytes} bytes.",
                    context=context,
                )
                encoded = (json.dumps(entry, ensure_ascii=False, default=str, separators=(",", ":")) + "\n").encode("utf-8")
                is_truncated = True
            else:
                is_truncated = False

            path = resolve_operation_log_path(str(row["log_path"]))
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("ab") as handle:
                handle.write(encoded)

            line_count = int(row["line_count"] or 0) + 1
            byte_size = current_size + len(encoded)
            level_counts = dict(row["level_counts"] or {})
            level_counts[entry["level"]] = int(level_counts.get(entry["level"], 0)) + 1
            cur.execute(
                """
                update operation_log_streams
                set line_count = %s,
                    byte_size = %s,
                    level_counts = %s,
                    last_level = %s,
                    last_message = %s,
                    last_log_at = now(),
                    is_truncated = %s
                where id = %s
                """,
                (
                    line_count,
                    byte_size,
                    Jsonb(level_counts),
                    entry["level"],
                    entry["message"],
                    is_truncated,
                    stream_id,
                ),
            )
        conn.commit()

    publish_event(
        "logs",
        "operation.log.appended",
        {
            "stream_id": stream_id,
            "scope_type": row["scope_type"],
            "scope_id": row["scope_id"],
            "level": entry["level"],
        },
    )
    return entry


def close_operation_log_stream(stream_id: int) -> None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update operation_log_streams
                set closed_at = coalesce(closed_at, now())
                where id = %s
                """,
                (stream_id,),
            )
        conn.commit()


def list_operation_log_streams(
    *,
    scope_type: str | None = None,
    scope_id: int | None = None,
    source_id: int | None = None,
    scan_run_id: int | None = None,
    level: str | None = None,
    keyword: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, object]:
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    filters: list[str] = []
    params: list[object] = []
    if scope_type:
        filters.append("scope_type = %s")
        params.append(scope_type)
    if scope_id is not None:
        filters.append("scope_id = %s")
        params.append(scope_id)
    if source_id is not None:
        filters.append("metadata->>'source_id' = %s")
        params.append(str(source_id))
    if scan_run_id is not None:
        filters.append("scope_type = 'source_scan'")
        filters.append("scope_id = %s")
        params.append(scan_run_id)
    if level:
        normalized = normalize_log_level(level)
        filters.append("level_counts ? %s")
        params.append(normalized)
    if keyword:
        filters.append("last_message ilike %s")
        params.append(f"%{keyword.strip()}%")
    where = f"where {' and '.join(filters)}" if filters else ""
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(f"select count(*)::int as count from operation_log_streams {where}", params)
            total_count = int(cur.fetchone()["count"])
            cur.execute(
                f"""
                select id, scope_type, scope_id, log_path, metadata, line_count,
                       byte_size, level_counts, last_level, last_message,
                       last_log_at, is_truncated, created_at, closed_at
                from operation_log_streams
                {where}
                order by coalesce(last_log_at, created_at) desc, id desc
                limit %s offset %s
                """,
                [*params, limit, offset],
            )
            rows = [dict(row) for row in cur.fetchall()]
    return {
        "rows": rows,
        "count": len(rows),
        "total_count": total_count,
        "limit": limit,
        "offset": offset,
    }


def read_operation_log_entries(
    stream_id: int,
    *,
    cursor: int | None = None,
    limit: int = DEFAULT_LOG_READ_LIMIT,
    levels: set[str] | None = None,
) -> dict[str, object]:
    stream = get_operation_log_stream(stream_id)
    if stream is None:
        raise ValueError("log_stream_not_found")
    log_path = str(stream["log_path"])
    path = resolve_operation_log_path(log_path)
    if not path.exists() or not path.is_file():
        return {
            "stream": stream,
            "entries": [],
            "next_cursor": cursor or 0,
            "available": False,
            "is_truncated": bool(stream.get("is_truncated")),
        }
    limit = max(1, min(limit, MAX_LOG_READ_LIMIT))
    normalized_levels = {normalize_log_level(level) for level in levels} if levels else None
    if cursor is None:
        entries, next_cursor = read_recent_entries(path, limit=limit, levels=normalized_levels)
    else:
        entries, next_cursor = read_entries_from_cursor(path, cursor=max(0, cursor), limit=limit, levels=normalized_levels)
    return {
        "stream": stream,
        "entries": entries,
        "next_cursor": next_cursor,
        "available": True,
        "is_truncated": bool(stream.get("is_truncated")),
    }


def get_operation_log_stream(stream_id: int) -> dict[str, Any] | None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select id, scope_type, scope_id, log_path, metadata, line_count,
                       byte_size, level_counts, last_level, last_message,
                       last_log_at, is_truncated, created_at, closed_at
                from operation_log_streams
                where id = %s
                """,
                (stream_id,),
            )
            row = cur.fetchone()
    return dict(row) if row else None


def read_recent_entries(path: Path, *, limit: int, levels: set[str] | None) -> tuple[list[dict[str, Any]], int]:
    entries: list[dict[str, Any]] = []
    with path.open("rb") as handle:
        for raw_line in handle:
            entry = decode_log_line(raw_line)
            if entry is None or (levels is not None and entry.get("level") not in levels):
                continue
            entries.append(entry)
            if len(entries) > limit:
                entries.pop(0)
        next_cursor = handle.tell()
    return entries, next_cursor


def read_entries_from_cursor(
    path: Path,
    *,
    cursor: int,
    limit: int,
    levels: set[str] | None,
) -> tuple[list[dict[str, Any]], int]:
    entries: list[dict[str, Any]] = []
    with path.open("rb") as handle:
        handle.seek(0, 2)
        size = handle.tell()
        handle.seek(min(cursor, size))
        while len(entries) < limit:
            raw_line = handle.readline()
            if not raw_line:
                break
            entry = decode_log_line(raw_line)
            if entry is None or (levels is not None and entry.get("level") not in levels):
                continue
            entries.append(entry)
        next_cursor = handle.tell()
    return entries, next_cursor


def decode_log_line(raw_line: bytes) -> dict[str, Any] | None:
    try:
        value = json.loads(raw_line.decode("utf-8", errors="replace"))
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def build_log_entry(
    level: str,
    component: str,
    message: str,
    *,
    raw: str | None = None,
    context: dict[str, Any] | None = None,
    exception: BaseException | None = None,
) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "timestamp": datetime.now(UTC).isoformat(),
        "level": normalize_log_level(level),
        "component": component,
        "message": message,
    }
    if raw is not None:
        entry["raw"] = raw
    if context:
        entry["context"] = json_safe_context(context)
    if exception is not None:
        entry["exception"] = {
            "type": type(exception).__name__,
            "message": redact_sensitive_text(str(exception)),
            "stack": redact_sensitive_text("".join(traceback.format_exception(exception))),
        }
    return entry


def parse_gallery_dl_log_level(line: str) -> str:
    match = re.search(r"\[(debug|info|warning|warn|error|critical)\]", line, re.IGNORECASE)
    if not match:
        return "info"
    value = match.group(1).lower()
    return "warning" if value == "warn" else normalize_log_level(value)


def normalize_log_level(level: str) -> str:
    value = str(level or "info").strip().lower()
    if value == "warn":
        value = "warning"
    if value not in VALID_LOG_LEVELS:
        return "info"
    return value


def redact_sensitive_text(value: str | None) -> str:
    if value is None:
        return ""
    redacted = str(value)
    for pattern, replacement in SENSITIVE_PATTERNS:
        redacted = pattern.sub(replacement, redacted)
    return redacted


def json_safe_context(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): json_safe_context(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe_context(item) for item in value]
    if isinstance(value, tuple):
        return [json_safe_context(item) for item in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def resolve_operation_log_path(log_path: str) -> Path:
    settings = get_settings()
    archive_dir = settings.archive_dir.resolve()
    path = (archive_dir / log_path).resolve()
    if archive_dir not in path.parents and path != archive_dir:
        raise ValueError("invalid_operation_log_path")
    return path
