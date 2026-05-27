from __future__ import annotations

import json
import shutil
import subprocess
from typing import Any
from urllib.parse import urlparse

from psycopg.types.json import Jsonb

from xarchiver.db import connect
from xarchiver.importer import extract_tweet_id, upsert_tweets
from xarchiver.services.queue import submit_archive_batch

VALID_SOURCE_TYPES = {"profile", "user_media", "likes", "bookmarks", "search", "manual"}
VALID_SOURCE_STATUSES = {"active", "paused", "completed", "failed"}


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
    return row


def list_sources(
    status: str | None = None,
    source_type: str | None = None,
    limit: int = 50,
) -> list[dict[str, object]]:
    filters: list[str] = []
    params: list[object] = []
    if status:
        filters.append("s.status = %s")
        params.append(normalize_source_status(status))
    if source_type:
        filters.append("s.source_type = %s")
        params.append(normalize_source_type(source_type))
    where = f"where {' and '.join(filters)}" if filters else ""
    params.append(limit)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                select s.*,
                       count(d.id)::int as discovered_tweet_count,
                       count(d.id) filter (where d.archive_run_id is null)::int as unsubmitted_tweet_count,
                       max(d.discovered_at) as latest_discovered_at
                from archive_sources s
                left join source_discovered_tweets d on d.source_id = s.id
                {where}
                group by s.id
                order by s.updated_at desc, s.id desc
                limit %s
                """,
                tuple(params),
            )
            return [dict(row) for row in cur.fetchall()]


def get_source(source_id: int) -> dict[str, object] | None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select s.*,
                       count(d.id)::int as discovered_tweet_count,
                       count(d.id) filter (where d.archive_run_id is null)::int as unsubmitted_tweet_count,
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
    return {**dict(source), "discovered": discovered}


def update_source_status(source_id: int, status: str) -> dict[str, object]:
    status = normalize_source_status(status)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update archive_sources
                set status = %s, updated_at = now()
                where id = %s
                returning *
                """,
                (status, source_id),
            )
            row = cur.fetchone()
            if row is None:
                raise ValueError("source_not_found")
        conn.commit()
    return dict(row)


def scan_source(source_id: int, limit: int = 20, restart: bool = False) -> dict[str, object]:
    source = get_source(source_id)
    if source is None:
        raise ValueError("source_not_found")
    if str(source.get("status")) == "paused":
        raise ValueError("source_paused")
    source_url = str(source.get("source_url") or "")
    scan_url = build_gallery_dl_scan_url(str(source.get("source_type") or ""), source_url)
    cursor_state = source.get("cursor_state") if isinstance(source.get("cursor_state"), dict) else {}
    scan_range = build_scan_range(cursor_state, limit, restart=restart)
    records, scan_meta = discover_records_with_gallery_dl(scan_url, scan_range["start"], scan_range["end"])
    if not records:
        update_source_cursor(
            source_id,
            cursor_state,
            scan_meta,
            scan_range,
            discovered_count=0,
            new_discovered_count=0,
            completed=scan_meta.get("exit_code") == 0,
        )
        completed = scan_meta.get("exit_code") == 0
        mark_source_scan_result(
            source_id,
            error_category=None if completed else scan_meta.get("error_category") or "download_no_output",
            error_message=None if completed else scan_meta.get("error_message") or "No tweets discovered for source.",
        )
        return {
            "source_id": source_id,
            "discovered_count": 0,
            "new_discovered_count": 0,
            "duplicate_count": 0,
            "submitted": None,
            "scanner": scan_meta,
        }
    result = record_source_discoveries(source_id, records, mark_scanned=True)
    completed = is_source_scan_complete(scan_meta, scan_range, int(result["discovered_count"]))
    update_source_cursor(
        source_id,
        cursor_state,
        scan_meta,
        scan_range,
        discovered_count=int(result["discovered_count"]),
        new_discovered_count=int(result["new_discovered_count"]),
        completed=completed,
    )
    return {
        "source_id": source_id,
        "discovered_count": result["discovered_count"],
        "new_discovered_count": result["new_discovered_count"],
        "duplicate_count": result["duplicate_count"],
        "completed": completed,
        "submitted": None,
        "scanner": scan_meta,
    }


def discover_records_with_gallery_dl(source_url: str, start: int, end: int) -> tuple[list[dict[str, Any]], dict[str, object]]:
    if start < 1 or end < start:
        raise ValueError("scan_limit_required")
    if shutil.which("gallery-dl") is None:
        return [], {"error_category": "command_not_found", "error_message": "gallery-dl"}
    command = [
        "gallery-dl",
        "--config",
        "/app/gallery-dl.conf",
        "--dump-json",
        "--range",
        f"{start}-{end}",
        source_url,
    ]
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
        "stderr_excerpt": stderr_excerpt,
        "scan_url": source_url,
        "range_start": start,
        "range_end": end,
    }


def build_scan_range(cursor_state: dict[str, Any], limit: int, restart: bool = False) -> dict[str, int]:
    if limit < 1:
        raise ValueError("scan_limit_required")
    start = 1 if restart else parse_positive_int(cursor_state.get("next_start_index"), default=1)
    end = start + limit - 1
    return {"start": start, "end": end, "limit": limit}


def is_source_scan_complete(scan_meta: dict[str, object], scan_range: dict[str, int], discovered_count: int) -> bool:
    if scan_meta.get("exit_code") != 0:
        return False
    return discovered_count < scan_range["limit"]


def parse_positive_int(value: object, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed >= 1 else default


def update_source_cursor(
    source_id: int,
    previous_cursor: dict[str, Any],
    scan_meta: dict[str, object],
    scan_range: dict[str, int],
    discovered_count: int,
    new_discovered_count: int,
    completed: bool,
) -> None:
    duplicate_count = max(discovered_count - new_discovered_count, 0)
    next_start = scan_range["end"] + 1 if discovered_count > 0 else scan_range["start"]
    cursor_state = {
        **previous_cursor,
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
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                update archive_sources
                set cursor_state = %s,
                    status = case when %s then 'completed' else status end,
                    updated_at = now()
                where id = %s
                """,
                (Jsonb(cursor_state), completed, source_id),
            )
        conn.commit()


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
    return list(rows.values())


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
                    """
                    insert into source_discovered_tweets (
                        source_id, tweet_id, raw_payload
                    )
                    values (%s, %s, %s)
                    on conflict (source_id, tweet_id) do update set
                        raw_payload = excluded.raw_payload,
                        discovered_at = now()
                    returning (xmax = 0) as inserted
                    """,
                    (source_id, tweet_id, Jsonb(record)),
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
    return {
        "discovered_count": len(unique_tweet_ids),
        "new_discovered_count": inserted,
        "duplicate_count": max(len(unique_tweet_ids) - inserted, 0),
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
    return {**submission, "source_id": source_id, "submitted_count": len(submitted_tweet_ids)}


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
    text = (stderr or "").lower()
    if any(pattern in text for pattern in ("login required", "sign in", "authentication", "403", "unauthorized")):
        return "auth_required"
    if "429" in text or "rate" in text:
        return "rate_limited"
    if any(pattern in text for pattern in ("timeout", "connection", "network", "temporary failure")):
        return "network_error"
    if "not found" in text or "404" in text:
        return "invalid_url"
    return "unknown"


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
