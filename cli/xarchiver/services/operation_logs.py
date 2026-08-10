"""结构化操作日志的存储与读取服务。"""

from __future__ import annotations

import json
import logging
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
logger = logging.getLogger(__name__)
SENSITIVE_PATTERNS = (
    (re.compile(r"(auth_token=)[^\s;&]+", re.IGNORECASE), r"\1[redacted]"),
    (re.compile(r"(ct0=)[^\s;&]+", re.IGNORECASE), r"\1[redacted]"),
    (re.compile(r"(cookie:\s*)[^\n\r]+", re.IGNORECASE), r"\1[redacted]"),
    (re.compile(r"(authorization:\s*(?:bearer|basic)\s+)[^\s\n\r]+", re.IGNORECASE), r"\1[redacted]"),
    (re.compile(r"(x-(?:csrf-token|guest-token|api-key):\s*)[^\s\n\r]+", re.IGNORECASE), r"\1[redacted]"),
    (
        re.compile(r"([?&](?:access_token|api_key|auth_token|ct0|key|oauth_token|signature|sig|token)=)[^&#\s]+", re.IGNORECASE),
        r"\1[redacted]",
    ),
    (re.compile(r"(postgres(?:ql)?(?:\+psycopg)?://[^:\s]+:)[^@\s]+@", re.IGNORECASE), r"\1[redacted]@"),
)


def create_operation_log_stream(
    scope_type: str,
    scope_id: int,
    log_path: str,
    metadata: dict[str, Any] | None = None,
) -> int:
    """在真正写日志文件前，先创建一条逻辑日志流记录。"""

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
    """追加一条结构化日志，并原子更新流级统计信息。"""

    entries = append_operation_log_entries(
        stream_id,
        [
            {
                "level": level,
                "component": component,
                "message": message,
                "raw": raw,
                "context": context,
                "exception": exception,
            }
        ],
    )
    return entries[0] if entries else None


def append_operation_log_entries(stream_id: int, entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """批量追加日志，以一次数据库事务和一次事件通知收敛高频输出。"""

    prepared_entries: list[dict[str, Any]] = []
    for value in entries:
        level = normalize_log_level(str(value.get("level") or "info"))
        message = redact_sensitive_text(str(value.get("message") or "")).strip()
        raw_value = value.get("raw")
        raw = redact_sensitive_text(str(raw_value)).rstrip("\n\r") if raw_value is not None else None
        exception = value.get("exception")
        if not message and not raw and exception is None:
            continue
        prepared_entries.append(
            build_log_entry(
                level,
                str(value.get("component") or "xarchiver"),
                message or raw or "",
                raw=raw,
                context=value.get("context") if isinstance(value.get("context"), dict) else None,
                exception=exception if isinstance(exception, BaseException) else None,
            )
        )
    if not prepared_entries:
        return []

    commit_attempted = False
    try:
        with connect() as conn:
            path: Path | None = None
            previous_file_size: int | None = None
            try:
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
                        return []
                    path = resolve_operation_log_path(str(row["log_path"]))
                    current_size = int(row["byte_size"] or 0)
                    actual_size = path.stat().st_size if path.exists() else 0
                    repaired_stats: dict[str, Any] | None = None
                    if actual_size != current_size:
                        repaired_stats = _read_operation_log_file_stats(path)
                        cur.execute(
                            """
                            update operation_log_streams
                            set line_count = %s,
                                byte_size = %s,
                                level_counts = %s,
                                last_level = %s,
                                last_message = %s,
                                last_log_at = case when %s > 0 then now() else null end,
                                is_truncated = %s
                            where id = %s
                            """,
                            (
                                repaired_stats["line_count"],
                                repaired_stats["byte_size"],
                                Jsonb(repaired_stats["level_counts"]),
                                repaired_stats["last_level"],
                                repaired_stats["last_message"],
                                repaired_stats["line_count"],
                                repaired_stats["is_truncated"],
                                stream_id,
                            ),
                        )
                    current_size = int(
                        repaired_stats["byte_size"] if repaired_stats else row["byte_size"] or 0
                    )
                    current_line_count = int(
                        repaired_stats["line_count"] if repaired_stats else row["line_count"] or 0
                    )
                    current_level_counts = dict(
                        repaired_stats["level_counts"] if repaired_stats else row["level_counts"] or {}
                    )
                    already_truncated = bool(
                        repaired_stats["is_truncated"] if repaired_stats else row["is_truncated"]
                    )
                    if already_truncated:
                        if repaired_stats is not None:
                            commit_attempted = True
                            conn.commit()
                        return []

                    max_bytes = int(get_settings().operation_log_max_bytes)
                    accepted_entries: list[dict[str, Any]] = []
                    encoded_entries: list[bytes] = []
                    encoded_size = 0
                    is_truncated = False
                    for entry in prepared_entries:
                        encoded = (json.dumps(entry, ensure_ascii=False, default=str, separators=(",", ":")) + "\n").encode("utf-8")
                        if current_size + encoded_size + len(encoded) <= max_bytes:
                            accepted_entries.append(entry)
                            encoded_entries.append(encoded)
                            encoded_size += len(encoded)
                            continue
                        # 达到体积上限后，只补一条告警并停止接收当前批剩余输出。
                        warning = build_log_entry("warning", "xarchiver", f"操作日志达到 {max_bytes} 字节后已截断。")
                        accepted_entries.append(warning)
                        encoded_entries.append(
                            (json.dumps(warning, ensure_ascii=False, default=str, separators=(",", ":")) + "\n").encode("utf-8")
                        )
                        is_truncated = True
                        break
                    if not accepted_entries:
                        return []

                    path.parent.mkdir(parents=True, exist_ok=True)
                    with path.open("a+b") as handle:
                        handle.seek(0, 2)
                        previous_file_size = handle.tell()
                        handle.writelines(encoded_entries)

                    line_count = current_line_count + len(accepted_entries)
                    byte_size = current_size + encoded_size + (len(encoded_entries[-1]) if is_truncated else 0)
                    level_counts = current_level_counts
                    for entry in accepted_entries:
                        level_counts[entry["level"]] = int(level_counts.get(entry["level"], 0)) + 1
                    last_entry = accepted_entries[-1]
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
                            last_entry["level"],
                            last_entry["message"],
                            is_truncated,
                            stream_id,
                        ),
                    )
                commit_attempted = True
                conn.commit()
            except BaseException:
                if not commit_attempted and path is not None and previous_file_size is not None:
                    _truncate_operation_log_file(path, previous_file_size)
                raise
    except BaseException:
        if commit_attempted:
            try:
                _reconcile_operation_log_stream(stream_id)
            except Exception:
                logger.critical(
                    "Failed to reconcile operation log metadata after uncertain commit: stream_id=%s",
                    stream_id,
                    exc_info=True,
                )
        raise

    publish_event(
        "logs",
        "operation.log.appended",
        {
            "stream_id": stream_id,
            "scope_type": row["scope_type"],
            "scope_id": row["scope_id"],
            "level": last_entry["level"],
            "entry_count": len(accepted_entries),
        },
    )
    return accepted_entries


def _truncate_operation_log_file(path: Path, size: int) -> None:
    try:
        with path.open("r+b") as handle:
            handle.truncate(size)
    except OSError:
        logger.critical(
            "Failed to roll back operation log file after pre-commit failure: %s",
            path,
            exc_info=True,
        )


def _reconcile_operation_log_stream(stream_id: int) -> None:
    """提交结果不确定时，以 JSONL 文件为事实源重建流级元数据。"""

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select log_path
                from operation_log_streams
                where id = %s
                for update
                """,
                (stream_id,),
            )
            row = cur.fetchone()
            if row is None:
                return
            stats = _read_operation_log_file_stats(
                resolve_operation_log_path(str(row["log_path"]))
            )
            cur.execute(
                """
                update operation_log_streams
                set line_count = %s,
                    byte_size = %s,
                    level_counts = %s,
                    last_level = %s,
                    last_message = %s,
                    last_log_at = case when %s > 0 then now() else null end,
                    is_truncated = %s
                where id = %s
                """,
                (
                    stats["line_count"],
                    stats["byte_size"],
                    Jsonb(stats["level_counts"]),
                    stats["last_level"],
                    stats["last_message"],
                    stats["line_count"],
                    stats["is_truncated"],
                    stream_id,
                ),
            )
        conn.commit()


def _read_operation_log_file_stats(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "line_count": 0,
            "byte_size": 0,
            "level_counts": {},
            "last_level": None,
            "last_message": None,
            "is_truncated": False,
        }

    line_count = 0
    level_counts: dict[str, int] = {}
    last_level: str | None = None
    last_message: str | None = None
    is_truncated = False
    file_size = path.stat().st_size
    valid_end = 0
    damaged_tail = False
    missing_final_newline = False

    def accumulate(entry: dict[str, Any]) -> None:
        nonlocal line_count, last_level, last_message, is_truncated
        level = normalize_log_level(str(entry.get("level") or "info"))
        message = str(entry.get("message") or "")
        line_count += 1
        level_counts[level] = level_counts.get(level, 0) + 1
        last_level = level
        last_message = message
        is_truncated = is_truncated or (
            entry.get("component") == "xarchiver"
            and message.startswith("操作日志达到 ")
            and message.endswith(" 字节后已截断。")
        )

    with path.open("r+b") as handle:
        while True:
            raw_line = handle.readline()
            if not raw_line:
                break
            line_end = handle.tell()
            is_final_line = line_end == file_size
            if not raw_line.strip():
                valid_end = line_end
                missing_final_newline = is_final_line and not raw_line.endswith(b"\n")
                continue
            try:
                entry = json.loads(raw_line.decode("utf-8"))
                if not isinstance(entry, dict):
                    raise ValueError("invalid_operation_log_entry")
            except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
                if not is_final_line:
                    raise ValueError("invalid_operation_log_entry") from exc
                damaged_tail = True
                break
            accumulate(entry)
            valid_end = line_end
            missing_final_newline = is_final_line and not raw_line.endswith(b"\n")

        if damaged_tail:
            handle.seek(valid_end)
            handle.truncate()
            recovery_entry = build_log_entry(
                "warning",
                "xarchiver",
                "操作日志尾部存在未完成记录，已恢复到最后一条完整记录。",
            )
            encoded = (
                json.dumps(
                    recovery_entry,
                    ensure_ascii=False,
                    default=str,
                    separators=(",", ":"),
                )
                + "\n"
            ).encode("utf-8")
            handle.write(encoded)
            valid_end += len(encoded)
            accumulate(recovery_entry)
            logger.warning("Recovered damaged operation log tail: %s", path)
        elif missing_final_newline:
            handle.seek(0, 2)
            handle.write(b"\n")
            valid_end += 1
        handle.flush()
    return {
        "line_count": line_count,
        "byte_size": valid_end,
        "level_counts": level_counts,
        "last_level": last_level,
        "last_message": last_message,
        "is_truncated": is_truncated,
    }


def close_operation_log_stream(stream_id: int) -> None:
    """把日志流标记为已关闭；底层文件仍然可读。"""

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
    """按作用域、级别和关键字过滤后返回日志流分页结果。"""

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
    """从日志流对应的 JSONL 文件中读取最近日志或增量日志。"""

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
    """按 ID 读取单条操作日志流记录。"""

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
    """从整个文件中读取最后 ``limit`` 条匹配日志。"""

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
    """从字节游标位置向后读取，供增量轮询场景使用。"""

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
    """解码单行 JSONL，容忍损坏数据或非对象结构。"""

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
    """构造写入日志文件的标准 JSON 结构。"""

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
    """从 gallery-dl 的 stderr 文本中提取标准化日志级别。"""

    match = re.search(r"\[(debug|info|warning|warn|error|critical)\]", line, re.IGNORECASE)
    if not match:
        return "info"
    value = match.group(1).lower()
    return "warning" if value == "warn" else normalize_log_level(value)


def normalize_log_level(level: str) -> str:
    """把未知级别回退到 ``info``，保持存储一致性。"""

    value = str(level or "info").strip().lower()
    if value == "warn":
        value = "warning"
    if value not in VALID_LOG_LEVELS:
        return "info"
    return value


def redact_sensitive_text(value: str | None) -> str:
    """在日志落盘前对 cookie 和数据库凭据做脱敏。"""

    if value is None:
        return ""
    redacted = str(value)
    for pattern, replacement in SENSITIVE_PATTERNS:
        redacted = pattern.sub(replacement, redacted)
    return redacted


def json_safe_context(value: Any) -> Any:
    """把常见 Python 值转换为可 JSON 序列化的结构。"""

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
    """将日志路径解析为 archive 相对路径，并禁止目录逃逸。"""

    settings = get_settings()
    archive_dir = settings.archive_dir.resolve()
    path = (archive_dir / log_path).resolve()
    if archive_dir not in path.parents and path != archive_dir:
        raise ValueError("invalid_operation_log_path")
    return path
