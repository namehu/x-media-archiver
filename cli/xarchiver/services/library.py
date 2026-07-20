"""面向媒体库视图的只读服务，覆盖推文、媒体、导出和重复项。"""

from __future__ import annotations

from pathlib import Path

from xarchiver.archive import ensure_archive_dirs
from xarchiver.config import Settings
from xarchiver.db import connect
from xarchiver.exporter import (
    count_all_duplicate_groups,
    count_duplicate_groups,
    count_duplicate_rows,
    fetch_duplicate_group_rows,
    fetch_duplicate_rows,
    fetch_export_rows,
)
from xarchiver.row_models import DownloadAttemptRow, RowModel, TweetDetailRow, TweetMediaAssetRow
from xarchiver.search import count_search_media, list_author_options, search_media, search_post_feed
from xarchiver.status import get_media_count, get_media_status_counts, get_status_counts

VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm"}


def get_summary(settings: Settings) -> dict[str, object]:
    """返回媒体库首页仪表盘所需的汇总信息。"""

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
    """返回可嵌入队列或来源结果中的精简媒体库快照。"""

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
    author_username: str | None = None,
) -> list[dict[str, object]]:
    """查询媒体记录，并补上基于归档路径生成的稳定访问地址。"""

    rows = search_media(
        author=author,
        text=text,
        tweet_status=tweet_status,
        media_status=None if media_status == "all" else media_status,
        media_type=media_type,
        limit=limit,
        offset=offset,
        author_username=author_username,
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
    author_username: str | None = None,
) -> dict[str, object]:
    """返回包含总数信息的媒体分页结果。"""

    rows = list_media(
        settings,
        author=author,
        text=text,
        tweet_status=tweet_status,
        media_status=media_status,
        media_type=media_type,
        limit=limit,
        offset=offset,
        author_username=author_username,
    )
    total_count = count_search_media(
        author=author,
        text=text,
        tweet_status=tweet_status,
        media_status=None if media_status == "all" else media_status,
        media_type=media_type,
        author_username=author_username,
    )
    return {"rows": rows, "count": len(rows), "total_count": total_count, "limit": limit, "offset": offset}


def get_author_options(query: str | None = None, limit: int = 20) -> dict[str, object]:
    """返回筛选面板使用的轻量作者建议列表。"""

    rows = [dict(row) for row in list_author_options(query=query, limit=limit)]
    return {"rows": rows, "count": len(rows)}


def list_posts_page(
    settings: Settings,
    source_id: int | None = None,
    source_type: str | None = None,
    author_username: str | None = None,
    text: str | None = None,
    media_type: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> dict[str, object]:
    """返回带媒体元数据的推文分页结果。"""

    posts, media_rows, total_count = search_post_feed(
        source_id=source_id,
        source_type=source_type,
        author_username=author_username,
        text=text,
        media_type=media_type,
        limit=limit,
        offset=offset,
    )
    media_by_tweet: dict[str, list[dict[str, object]]] = {}
    for media_row in media_rows:
        media_by_tweet.setdefault(media_row.tweet_id, []).append(
            attach_media_url(media_row, settings.archive_dir)
        )
    rows = [
        {
            **dict(post),
            "media": media_by_tweet.get(post.tweet_id, []),
        }
        for post in posts
    ]
    return {
        "rows": rows,
        "count": len(rows),
        "total_count": total_count,
        "limit": limit,
        "offset": offset,
    }


def get_tweet_detail(settings: Settings, tweet_id: str) -> dict[str, object] | None:
    """一次性读取推文详情、关联媒体及最近下载尝试。"""

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
            tweet_row = cur.fetchone()
            if not tweet_row:
                return None
            tweet = TweetDetailRow.model_validate(dict(tweet_row))

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
            media = [
                attach_media_url(
                    TweetMediaAssetRow.model_validate(dict(row)),
                    settings.archive_dir,
                )
                for row in cur.fetchall()
            ]

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
            attempts = [
                dict(DownloadAttemptRow.model_validate(dict(row)))
                for row in cur.fetchall()
            ]

    return {"tweet": dict(tweet), "media": media, "attempts": attempts}


def list_export_media(settings: Settings, status: str | None = "verified") -> list[dict[str, object]]:
    """返回可导出的媒体记录，结构与 API 返回保持一致。"""

    return [attach_media_url(row, settings.archive_dir) for row in fetch_export_rows(status)]


def list_duplicates(settings: Settings) -> dict[str, object]:
    """以内存分组的方式返回全部重复媒体记录。"""

    rows = [attach_media_url(row, settings.archive_dir) for row in fetch_duplicate_rows()]
    return {"duplicate_groups": count_duplicate_groups(rows), "rows": rows}


def list_duplicates_page(settings: Settings, limit: int = 100, offset: int = 0) -> dict[str, object]:
    """返回适配 WebUI 的重复媒体分页分组结果。"""

    rows = [attach_media_url(row, settings.archive_dir) for row in fetch_duplicate_group_rows(limit=limit, offset=offset)]
    groups: list[dict[str, object]] = []
    for row in rows:
        if not groups or groups[-1]["sha256"] != row["sha256"]:
            groups.append(
                {
                    "sha256": row["sha256"],
                    "duplicate_count": row["duplicate_count"],
                    "total_size": row["total_size"],
                    "rows": [],
                }
            )
        groups[-1]["rows"].append(row)
    duplicate_groups = count_all_duplicate_groups()
    return {
        "duplicate_groups": duplicate_groups,
        "total_media_count": count_duplicate_rows(),
        "groups": groups,
        "count": len(groups),
        "total_count": duplicate_groups,
        "limit": limit,
        "offset": offset,
    }


def list_recent_exports(archive_dir: Path, limit: int = 5) -> list[dict[str, object]]:
    """列出 ``archive/exports`` 下最近生成的导出文件。"""

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


def attach_media_url(row: dict[str, object] | RowModel, archive_dir: Path) -> dict[str, object]:
    """根据本地归档路径补充下载地址和预览地址。"""

    values = dict(row)
    local_path = values.get("local_path")
    relative_path = archive_relative_path(local_path, archive_dir)
    values["media_relative_path"] = relative_path
    values["media_url"] = f"/api/v1/media-file/{relative_path}" if relative_path else None
    preview_relative_path = media_preview_relative_path(values, archive_dir, relative_path)
    values["preview_relative_path"] = preview_relative_path or None
    values["preview_url"] = versioned_media_url(archive_dir, preview_relative_path) if preview_relative_path else None
    return values


def media_preview_relative_path(values: dict[str, object], archive_dir: Path, relative_path: str) -> str:
    """视频优先返回生成的预览图路径，否则直接复用媒体路径。"""

    if not relative_path:
        return ""
    is_video = values.get("media_type") == "video" or Path(relative_path).suffix.lower() in VIDEO_EXTENSIONS
    if not is_video:
        return relative_path
    media_path = archive_dir / relative_path
    preview_path = media_path.with_name(f"{media_path.stem}.preview.jpg")
    if not preview_path.is_file():
        return ""
    return archive_relative_path(preview_path, archive_dir)


def versioned_media_url(archive_dir: Path, relative_path: str) -> str:
    """根据文件元数据追加缓存击穿用的版本参数。"""

    url = f"/api/v1/media-file/{relative_path}"
    try:
        stat = (archive_dir / relative_path).stat()
    except OSError:
        return url
    return f"{url}?v={stat.st_mtime_ns:x}-{stat.st_size:x}"


def archive_relative_path(value: object, archive_dir: Path) -> str:
    """把存储路径规范化为 API 可识别的 archive 相对路径。"""

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
