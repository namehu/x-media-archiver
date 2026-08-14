"""面向媒体库视图的只读服务，覆盖推文、媒体、导出和重复项。"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path

from sqlalchemy import and_, func, select

from xarchiver.archive import ensure_archive_dirs
from xarchiver.config import Settings
from xarchiver.db import connect
from xarchiver.exporter import (
    count_all_duplicate_groups,
    count_duplicate_groups,
    count_duplicate_rows,
    count_failure_rows,
    fetch_duplicate_group_rows,
    fetch_duplicate_rows,
    fetch_export_rows,
)
from xarchiver.row_models import (
    DownloadAttemptRow,
    InsightAuthorRow,
    InsightCountRow,
    InsightDiscoverySummaryRow,
    InsightDistributionRow,
    InsightMediaStatsRow,
    InsightMonthRow,
    InsightOrganizationCoverageRow,
    InsightPublishedMonthRow,
    InsightTweetStatsRow,
    RowModel,
    TweetDetailRow,
    TweetMediaAssetRow,
)
from xarchiver.search import (
    count_search_media,
    fetch_tweet_search_organization,
    list_author_options,
    list_tweet_search_options,
    search_media,
    search_post_feed,
    search_tweet_library,
)
from xarchiver.services.hashtags import fetch_tweet_hashtags, list_hashtag_options
from xarchiver.services.operation_logs import redact_sensitive_text
from xarchiver.services.organization import get_tweet_organization, list_organization_catalog
from xarchiver.sql_builder import compile_query
from xarchiver.status import get_media_count, get_media_status_counts, get_status_counts
from xarchiver.tables import (
    archive_sources,
    collection_tweets,
    media_assets,
    source_discovered_tweets,
    tweet_notes,
    tweet_tags,
    tweets,
)

VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm"}


def get_summary(settings: Settings) -> dict[str, object]:
    """返回媒体库首页仪表盘所需的汇总信息。"""

    ensure_archive_dirs(settings.archive_dir)
    status_counts = get_status_counts()
    media_count = get_media_count()
    failures = count_failure_rows(disposition="open")
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


def get_library_insights() -> dict[str, object]:
    """返回只依赖数据库事实的归档洞察，不扫描文件系统或访问外部网络。"""

    with connect() as conn:
        with conn.cursor() as cur:
            # SQLAlchemy Core 没有事务级只读/快照声明；这里用 PostgreSQL 原生命令保证整组聚合一致且拒绝写入。
            cur.execute("set transaction isolation level repeatable read, read only")
            tweet_stats_statement = select(
                func.count().label("tweet_count"),
                func.count().filter(tweets.c.published_at.is_not(None)).label("published_at_count"),
                func.count()
                .filter(func.nullif(func.btrim(tweets.c.author_username), "").is_not(None))
                .label("author_present_count"),
                func.count()
                .filter(func.nullif(func.btrim(tweets.c.text), "").is_not(None))
                .label("text_count"),
                func.count(func.distinct(tweets.c.author_username))
                .filter(func.nullif(func.btrim(tweets.c.author_username), "").is_not(None))
                .label("author_count"),
            ).select_from(tweets)
            cur.execute(*compile_query(tweet_stats_statement))
            tweet_stats = InsightTweetStatsRow.model_validate(dict(cur.fetchone()))

            media_stats_statement = select(
                func.count().label("media_count"),
                func.coalesce(func.sum(media_assets.c.file_size), 0).label("known_media_bytes"),
                func.coalesce(func.sum(media_assets.c.duration_ms).filter(media_assets.c.media_type == "video"), 0)
                .label("known_video_duration_ms"),
                func.count().filter(media_assets.c.file_size.is_not(None)).label("media_file_size_count"),
                func.count()
                .filter(func.nullif(func.btrim(media_assets.c.sha256), "").is_not(None))
                .label("media_sha256_count"),
                func.count()
                .filter(and_(media_assets.c.width.is_not(None), media_assets.c.height.is_not(None)))
                .label("media_dimensions_count"),
                func.count().filter(media_assets.c.media_type == "video").label("video_count"),
                func.count()
                .filter(and_(media_assets.c.media_type == "video", media_assets.c.duration_ms.is_not(None)))
                .label("video_duration_count"),
            ).select_from(media_assets)
            cur.execute(*compile_query(media_stats_statement))
            media_stats = InsightMediaStatsRow.model_validate(dict(cur.fetchone()))

            source_count_statement = (
                select(func.count().label("count"))
                .select_from(archive_sources)
                .where(archive_sources.c.deleted_at.is_(None))
            )
            cur.execute(*compile_query(source_count_statement))
            source_count = InsightCountRow.model_validate(dict(cur.fetchone())).count

            media_type_key = func.coalesce(media_assets.c.media_type, "unknown")
            media_types_statement = (
                select(
                    media_type_key.label("key"),
                    func.count().label("count"),
                    func.coalesce(func.sum(media_assets.c.file_size), 0).label("known_bytes"),
                )
                .select_from(media_assets)
                .group_by(media_type_key)
                .order_by(func.count().desc(), media_type_key)
            )
            cur.execute(*compile_query(media_types_statement))
            media_types = [
                dict(InsightDistributionRow.model_validate(dict(row)))
                for row in cur.fetchall()
            ]

            media_status_key = func.coalesce(media_assets.c.download_status, "unknown")
            media_statuses_statement = (
                select(
                    media_status_key.label("key"),
                    func.count().label("count"),
                    func.coalesce(func.sum(media_assets.c.file_size), 0).label("known_bytes"),
                )
                .select_from(media_assets)
                .group_by(media_status_key)
                .order_by(func.count().desc(), media_status_key)
            )
            cur.execute(*compile_query(media_statuses_statement))
            media_statuses = [
                dict(InsightDistributionRow.model_validate(dict(row)))
                for row in cur.fetchall()
            ]

            published_month = func.date_trunc("month", tweets.c.published_at, "UTC")
            published_statement = (
                select(
                    published_month.label("month"),
                    func.count(func.distinct(tweets.c.tweet_id)).label("count"),
                    func.count(media_assets.c.id).label("media_count"),
                    func.coalesce(func.sum(media_assets.c.file_size), 0).label("known_bytes"),
                )
                .select_from(tweets.outerjoin(media_assets, media_assets.c.tweet_id == tweets.c.tweet_id))
                .where(tweets.c.published_at.is_not(None))
                .group_by(published_month)
                .order_by(published_month.desc())
                .limit(24)
            )
            cur.execute(*compile_query(published_statement))
            published_months = [
                dict(InsightPublishedMonthRow.model_validate(dict(row)))
                for row in reversed(cur.fetchall())
            ]

            imported_month = func.date_trunc("month", tweets.c.imported_at, "UTC")
            imported_statement = (
                select(imported_month.label("month"), func.count().label("count"))
                .select_from(tweets)
                .where(tweets.c.imported_at.is_not(None))
                .group_by(imported_month)
                .order_by(imported_month.desc())
                .limit(24)
            )
            cur.execute(*compile_query(imported_statement))
            imported_months = [
                dict(InsightMonthRow.model_validate(dict(row)))
                for row in reversed(cur.fetchall())
            ]

            known_bytes = func.coalesce(func.sum(media_assets.c.file_size), 0)
            top_authors_statement = (
                select(
                    tweets.c.author_username,
                    func.count(func.distinct(tweets.c.tweet_id)).label("tweet_count"),
                    func.count(media_assets.c.id).label("media_count"),
                    known_bytes.label("known_bytes"),
                )
                .select_from(tweets.join(media_assets, media_assets.c.tweet_id == tweets.c.tweet_id))
                .where(func.nullif(func.btrim(tweets.c.author_username), "").is_not(None))
                .group_by(tweets.c.author_username)
                .order_by(known_bytes.desc(), func.count(media_assets.c.id).desc(), tweets.c.author_username)
                .limit(10)
            )
            cur.execute(*compile_query(top_authors_statement))
            top_authors = [
                dict(InsightAuthorRow.model_validate(dict(row)))
                for row in cur.fetchall()
            ]

            tagged = select(tweet_tags.c.tweet_id).where(tweet_tags.c.tweet_id == tweets.c.tweet_id).exists()
            collected = (
                select(collection_tweets.c.tweet_id)
                .where(collection_tweets.c.tweet_id == tweets.c.tweet_id)
                .exists()
            )
            noted = select(tweet_notes.c.tweet_id).where(tweet_notes.c.tweet_id == tweets.c.tweet_id).exists()
            organization_statement = select(
                func.count().label("total_count"),
                func.count().filter(tagged).label("tagged_count"),
                func.count().filter(collected).label("collected_count"),
                func.count().filter(noted).label("noted_count"),
                func.count().filter(tagged | collected | noted).label("organized_count"),
            ).select_from(tweets)
            cur.execute(*compile_query(organization_statement))
            organization = InsightOrganizationCoverageRow.model_validate(dict(cur.fetchone()))

            discovered_tweet_id = func.distinct(source_discovered_tweets.c.tweet_id)
            discovery_statement = (
                select(
                    func.count(discovered_tweet_id).label("discovered_count"),
                    func.count(discovered_tweet_id)
                    .filter(source_discovered_tweets.c.archive_run_id.is_not(None))
                    .label("submitted_count"),
                    func.count(discovered_tweet_id)
                    .filter(tweets.c.download_status == "verified")
                    .label("verified_count"),
                )
                .select_from(
                    source_discovered_tweets.join(
                        tweets,
                        tweets.c.tweet_id == source_discovered_tweets.c.tweet_id,
                    )
                )
            )
            cur.execute(*compile_query(discovery_statement))
            discovery = InsightDiscoverySummaryRow.model_validate(dict(cur.fetchone()))

    return {
        "overview": {
            "tweet_count": tweet_stats.tweet_count,
            "media_count": media_stats.media_count,
            "known_media_bytes": media_stats.known_media_bytes,
            "known_video_duration_ms": media_stats.known_video_duration_ms,
            "author_count": tweet_stats.author_count,
            "source_count": source_count,
        },
        "media_types": media_types,
        "media_statuses": media_statuses,
        "published_months": published_months,
        "imported_months": imported_months,
        "top_authors": top_authors,
        "organization": dict(organization),
        "completeness": {
            "tweet_count": tweet_stats.tweet_count,
            "published_at_count": tweet_stats.published_at_count,
            "author_count": tweet_stats.author_present_count,
            "text_count": tweet_stats.text_count,
            "media_count": media_stats.media_count,
            "media_file_size_count": media_stats.media_file_size_count,
            "media_sha256_count": media_stats.media_sha256_count,
            "media_dimensions_count": media_stats.media_dimensions_count,
            "video_count": media_stats.video_count,
            "video_duration_count": media_stats.video_duration_count,
        },
        "discovery": dict(discovery),
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
    organization: dict[str, dict[str, object]] = {}
    if posts:
        with connect() as conn:
            with conn.cursor() as cur:
                organization = fetch_tweet_search_organization(
                    cur,
                    [post.tweet_id for post in posts],
                )
    rows = [
        {
            **dict(post),
            **feed_organization_summary(organization.get(post.tweet_id)),
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


def feed_organization_summary(labels: dict[str, object] | None) -> dict[str, object]:
    """把完整整理信息压缩成帖子卡片所需的三项摘要。"""

    values = labels or {"hashtags": [], "tags": [], "collections": [], "note_excerpt": None}
    return {
        "hashtags": list(values.get("hashtags") or []),
        "tags": list(values.get("tags") or [])[:3],
        "collection_count": len(list(values.get("collections") or [])),
        "has_note": bool(values.get("note_excerpt")),
    }


def search_tweets_page(
    settings: Settings,
    query: str | None = None,
    source_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    media_type: str | None = None,
    tweet_status: str | None = "verified",
    tag_id: int | None = None,
    collection_id: int | None = None,
    hashtag: str | None = None,
    sort: str = "auto",
    client_utc_offset_minutes: int = 0,
    limit: int = 20,
    offset: int = 0,
) -> dict[str, object]:
    """返回 Tweet 级全局搜索结果；日期按浏览器本地日界线换算为 UTC。"""

    client_offset = timedelta(minutes=client_utc_offset_minutes)
    start_at = (
        datetime.combine(date_from, time.min, tzinfo=UTC) + client_offset
        if date_from
        else None
    )
    end_at = (
        datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=UTC)
        + client_offset
        if date_to
        else None
    )
    rows, media_rows, organization, total_count = search_tweet_library(
        query=query,
        source_id=source_id,
        date_from=start_at,
        date_to=end_at,
        media_type=media_type,
        tweet_status=tweet_status,
        tag_id=tag_id,
        collection_id=collection_id,
        hashtag=hashtag,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    media_by_tweet: dict[str, list[dict[str, object]]] = {}
    for media_row in media_rows:
        media_by_tweet.setdefault(media_row.tweet_id, []).append(
            attach_media_url(media_row, settings.archive_dir)
        )
    result_rows = []
    for row in rows:
        labels = organization.get(
            row.tweet_id,
            {"hashtags": [], "tags": [], "collections": [], "note_excerpt": None},
        )
        result_rows.append(
            {
                **dict(row),
                **labels,
                "media": media_by_tweet.get(row.tweet_id, []),
            }
        )
    return {
        "rows": result_rows,
        "count": len(result_rows),
        "total_count": total_count,
        "limit": limit,
        "offset": offset,
    }


def get_tweet_search_options() -> dict[str, object]:
    """返回全局搜索页面的标签与合集筛选项。"""

    tag_rows, collection_rows = list_tweet_search_options()
    return {
        "tags": [dict(row) for row in tag_rows],
        "collections": [dict(row) for row in collection_rows],
    }


def get_tweet_hashtag_options(query: str | None = None, limit: int = 20) -> dict[str, object]:
    """返回有界的平台 Hashtag 联想结果。"""

    rows = [dict(row) for row in list_hashtag_options(query=query, limit=limit)]
    return {"rows": rows, "count": len(rows)}


def list_organization_catalog_page(settings: Settings) -> dict[str, object]:
    """返回整理页使用的完整标签与合集目录。"""

    return list_organization_catalog(settings.archive_dir)


def list_collection_tweets_page(
    settings: Settings,
    collection_id: int,
    *,
    limit: int = 20,
    offset: int = 0,
) -> dict[str, object]:
    """返回单个合集的 Tweet 级帖子流。"""

    from xarchiver.services.organization import collection_page_metadata

    collection, total_count = collection_page_metadata(collection_id)
    if total_count == 0 or offset >= total_count:
        return {
            "collection": collection,
            "rows": [],
            "count": 0,
            "total_count": total_count,
            "limit": limit,
            "offset": offset,
        }
    rows, media_rows, organization, _ = search_tweet_library(
        collection_id=collection_id,
        tweet_status="all",
        sort="newest",
        limit=limit,
        offset=offset,
    )
    media_by_tweet: dict[str, list[dict[str, object]]] = {}
    for media_row in media_rows:
        media_by_tweet.setdefault(media_row.tweet_id, []).append(
            attach_media_url(media_row, settings.archive_dir)
        )
    result_rows = []
    for row in rows:
        labels = organization.get(
            row.tweet_id,
            {"hashtags": [], "tags": [], "collections": [], "note_excerpt": None},
        )
        result_rows.append(
            {
                **dict(row),
                **labels,
                "media": media_by_tweet.get(row.tweet_id, []),
            }
        )
    return {
        "collection": collection,
        "rows": result_rows,
        "count": len(result_rows),
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
                select a.id, a.job_id, a.engine, a.status, a.exit_code,
                       a.error_category, a.error_message, a.stderr_excerpt,
                       j.log_stream_id, a.finished_at
                from download_attempts a
                left join download_jobs j on j.id = a.job_id
                where a.tweet_id = %s
                order by a.finished_at desc nulls last, a.id desc
                limit 20
                """,
                (tweet_id,),
            )
            attempts = []
            for row in cur.fetchall():
                value = dict(row)
                value["stderr_excerpt"] = redact_sensitive_text(value.get("stderr_excerpt")) or None
                attempts.append(dict(DownloadAttemptRow.model_validate(value)))

            hashtags = fetch_tweet_hashtags(cur, [tweet_id])[tweet_id]

    organization = get_tweet_organization(tweet_id)
    assert organization is not None
    return {
        "tweet": dict(tweet),
        "hashtags": hashtags,
        "media": media,
        "attempts": attempts,
        "organization": organization,
    }


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
