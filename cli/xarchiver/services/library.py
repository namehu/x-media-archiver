from __future__ import annotations

from pathlib import Path

from xarchiver.archive import ensure_archive_dirs
from xarchiver.config import Settings
from xarchiver.db import connect
from xarchiver.exporter import count_duplicate_groups, fetch_duplicate_rows, fetch_export_rows
from xarchiver.search import count_search_media, search_media
from xarchiver.status import get_media_count, get_media_status_counts, get_status_counts


def get_summary(settings: Settings) -> dict[str, object]:
    ensure_archive_dirs(settings.archive_dir)
    status_counts = get_status_counts()
    media_count = get_media_count()
    failures = sum(
        count
        for status, count in status_counts.items()
        if status not in {"downloaded", "verified", "skipped"}
    )
    return {
        "tweet_status_counts": status_counts,
        "media_count": media_count,
        "failure_count": failures,
        "archive_dir": settings.archive_dir.as_posix(),
        "exports": list_recent_exports(settings.archive_dir),
    }


def get_library_snapshot() -> dict[str, int]:
    media_status_counts = get_media_status_counts()
    return {
        "media_total": sum(media_status_counts.values()),
        "verified_total": media_status_counts.get("verified", 0),
    }


def list_media(
    settings: Settings,
    author: str | None = None,
    text: str | None = None,
    tweet_status: str | None = None,
    media_status: str | None = "verified",
    media_type: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, object]]:
    rows = search_media(
        author=author,
        text=text,
        tweet_status=tweet_status,
        media_status=None if media_status == "all" else media_status,
        media_type=media_type,
        limit=limit,
        offset=offset,
    )
    return [attach_media_url(row, settings.archive_dir) for row in rows]


def list_media_page(
    settings: Settings,
    author: str | None = None,
    text: str | None = None,
    tweet_status: str | None = None,
    media_status: str | None = "verified",
    media_type: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, object]:
    rows = list_media(
        settings,
        author=author,
        text=text,
        tweet_status=tweet_status,
        media_status=media_status,
        media_type=media_type,
        limit=limit,
        offset=offset,
    )
    total_count = count_search_media(
        author=author,
        text=text,
        tweet_status=tweet_status,
        media_status=None if media_status == "all" else media_status,
        media_type=media_type,
    )
    return {"rows": rows, "count": len(rows), "total_count": total_count, "limit": limit, "offset": offset}


def get_tweet_detail(settings: Settings, tweet_id: str) -> dict[str, object] | None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select
                    tweet_id,
                    url as tweet_url,
                    author_username,
                    author_display_name,
                    published_at,
                    text as tweet_text,
                    download_status as tweet_status,
                    last_error,
                    retry_count,
                    imported_at,
                    updated_at
                from tweets
                where tweet_id = %s
                """,
                (tweet_id,),
            )
            tweet = cur.fetchone()
            if not tweet:
                return None

            cur.execute(
                """
                select
                    id,
                    media_index,
                    media_type,
                    download_status as media_status,
                    source_engine,
                    local_path,
                    metadata_path,
                    original_filename,
                    file_ext,
                    file_size,
                    sha256,
                    width,
                    height,
                    duration_ms,
                    error_message,
                    updated_at
                from media_assets
                where tweet_id = %s
                order by media_index nulls last, id
                """,
                (tweet_id,),
            )
            media = [attach_media_url(row, settings.archive_dir) for row in cur.fetchall()]

            cur.execute(
                """
                select
                    id,
                    job_id,
                    engine,
                    status,
                    exit_code,
                    error_category,
                    error_message,
                    finished_at
                from download_attempts
                where tweet_id = %s
                order by finished_at desc nulls last, id desc
                limit 20
                """,
                (tweet_id,),
            )
            attempts = list(cur.fetchall())

    return {"tweet": tweet, "media": media, "attempts": attempts}


def list_export_media(settings: Settings, status: str | None = "verified") -> list[dict[str, object]]:
    return [attach_media_url(row, settings.archive_dir) for row in fetch_export_rows(status)]


def list_duplicates(settings: Settings) -> dict[str, object]:
    rows = [attach_media_url(row, settings.archive_dir) for row in fetch_duplicate_rows()]
    return {"duplicate_groups": count_duplicate_groups(rows), "rows": rows}


def list_recent_exports(archive_dir: Path, limit: int = 5) -> list[dict[str, object]]:
    exports_dir = archive_dir / "exports"
    if not exports_dir.exists():
        return []
    files = sorted(
        (path for path in exports_dir.iterdir() if path.is_file()),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    return [
        {
            "name": path.name,
            "path": path.as_posix(),
            "size": path.stat().st_size,
            "modified_at": path.stat().st_mtime,
        }
        for path in files[:limit]
    ]


def attach_media_url(row: dict[str, object], archive_dir: Path) -> dict[str, object]:
    values = dict(row)
    local_path = values.get("local_path")
    relative_path = archive_relative_path(local_path, archive_dir)
    values["media_relative_path"] = relative_path
    values["media_url"] = f"/api/media-file/{relative_path}" if relative_path else None
    return values


def archive_relative_path(value: object, archive_dir: Path) -> str:
    if not value:
        return ""
    path_text = str(value).replace("\\", "/")
    archive_text = archive_dir.as_posix().rstrip("/")
    if path_text.startswith(f"{archive_text}/"):
        return path_text[len(archive_text) + 1 :]
    marker = "/archive/"
    if marker in path_text:
        return path_text.split(marker, 1)[1]
    return path_text
