"""媒体检索与帖子流查询辅助函数。"""

from __future__ import annotations

from sqlalchemy import (
    Integer,
    and_,
    bindparam,
    exists,
    func,
    literal_column,
    or_,
    select,
)
from sqlalchemy.sql import ColumnElement, Select

from xarchiver.db import connect
from xarchiver.row_models import AuthorOptionRow, PostFeedMediaRow, PostFeedRow, SearchMediaRow
from xarchiver.sql_builder import compile_query
from xarchiver.tables import archive_sources, media_assets, source_discovered_tweets, tweets


def search_media(
    author: str | None = None,
    text: str | None = None,
    tweet_status: str | None = None,
    media_status: str | None = "verified",
    media_type: str | None = None,
    limit: int = 20,
    offset: int = 0,
    author_username: str | None = None,
) -> list[SearchMediaRow]:
    """按作者、文本和状态等条件查询媒体列表。"""

    sql, params = build_search_query(
        author,
        text,
        tweet_status,
        media_status,
        media_type,
        limit,
        offset,
        author_username,
    )
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [SearchMediaRow.model_validate(dict(row)) for row in cur.fetchall()]


def count_search_media(
    author: str | None = None,
    text: str | None = None,
    tweet_status: str | None = None,
    media_status: str | None = "verified",
    media_type: str | None = None,
    author_username: str | None = None,
) -> int:
    """统计媒体检索结果总数。"""

    sql, params = build_count_query(
        author,
        text,
        tweet_status,
        media_status,
        media_type,
        author_username,
    )
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return int(cur.fetchone()["count"])


def build_search_query(
    author: str | None,
    text: str | None,
    tweet_status: str | None,
    media_status: str | None,
    media_type: str | None,
    limit: int,
    offset: int = 0,
    author_username: str | None = None,
) -> tuple[str, dict[str, object]]:
    """构造媒体检索分页查询。"""

    statement = (
        select(
            media_assets.c.id,
            tweets.c.tweet_id,
            tweets.c.url.label("tweet_url"),
            tweets.c.author_username,
            tweets.c.author_display_name,
            tweets.c.published_at,
            func.coalesce(tweets.c.text, literal_column("''")).label("tweet_text"),
            tweets.c.download_status.label("tweet_status"),
            media_assets.c.media_index,
            media_assets.c.media_type,
            media_assets.c.download_status.label("media_status"),
            media_assets.c.source_engine,
            media_assets.c.local_path,
            media_assets.c.file_size,
            media_assets.c.width,
            media_assets.c.height,
            media_assets.c.duration_ms,
        )
        .select_from(media_assets.join(tweets, tweets.c.tweet_id == media_assets.c.tweet_id))
        .order_by(
            tweets.c.published_at.desc().nulls_last(),
            tweets.c.imported_at.desc(),
            media_assets.c.media_index.asc().nulls_last(),
            media_assets.c.id.asc(),
        )
        .limit(bindparam("limit", limit))
        .offset(bindparam("offset", offset))
    )
    statement = apply_search_filters(
        statement,
        author,
        text,
        tweet_status,
        media_status,
        media_type,
        author_username,
    )
    return compile_query(statement)


def build_count_query(
    author: str | None,
    text: str | None,
    tweet_status: str | None,
    media_status: str | None,
    media_type: str | None,
    author_username: str | None = None,
) -> tuple[str, dict[str, object]]:
    """构造媒体检索数量查询。"""

    statement = select(func.count().cast(Integer).label("count")).select_from(
        media_assets.join(tweets, tweets.c.tweet_id == media_assets.c.tweet_id)
    )
    statement = apply_search_filters(
        statement,
        author,
        text,
        tweet_status,
        media_status,
        media_type,
        author_username,
    )
    return compile_query(statement)


def apply_search_filters(
    statement: Select,
    author: str | None,
    text: str | None,
    tweet_status: str | None,
    media_status: str | None,
    media_type: str | None,
    author_username: str | None = None,
) -> Select:
    """把检索过滤条件应用到 SQLAlchemy 语句上。"""

    conditions = build_search_conditions(
        author,
        text,
        tweet_status,
        media_status,
        media_type,
        author_username,
    )
    if not conditions:
        return statement
    return statement.where(and_(*conditions))


def build_search_conditions(
    author: str | None,
    text: str | None,
    tweet_status: str | None,
    media_status: str | None,
    media_type: str | None,
    author_username: str | None = None,
) -> list[ColumnElement[bool]]:
    """构造媒体检索过滤条件。"""

    conditions: list[ColumnElement[bool]] = []

    if author:
        pattern = f"%{author}%"
        author_pattern = bindparam("author_pattern", pattern)
        conditions.append(
            or_(
                tweets.c.author_username.ilike(author_pattern),
                tweets.c.author_display_name.ilike(author_pattern),
            )
        )
    if author_username:
        normalized_username = str(author_username).strip().lstrip("@").strip().lower()
        conditions.append(
            func.lower(tweets.c.author_username)
            == bindparam("author_username", normalized_username)
        )
    if text:
        conditions.append(tweets.c.text.ilike(bindparam("text_pattern", f"%{text}%")))
    if tweet_status:
        conditions.append(tweets.c.download_status == bindparam("tweet_status", tweet_status))
    if media_status and media_status != "all":
        conditions.append(media_assets.c.download_status == bindparam("media_status", media_status))
    if media_type:
        conditions.append(media_assets.c.media_type == bindparam("media_type", media_type))
    return conditions


def list_author_options(query: str | None = None, limit: int = 20) -> list[AuthorOptionRow]:
    """查询作者筛选项候选列表。"""

    sql, params = build_author_options_query(query, limit)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [AuthorOptionRow.model_validate(dict(row)) for row in cur.fetchall()]


def build_author_options_query(
    query: str | None,
    limit: int,
) -> tuple[str, dict[str, object]]:
    """构造作者候选列表查询。"""

    normalized_query = str(query or "").strip().lstrip("@").strip()
    username = func.min(tweets.c.author_username).label("author_username")
    display_name = func.min(tweets.c.author_display_name).label("author_display_name")
    media_count = func.count(media_assets.c.id).cast(Integer).label("media_count")
    statement = (
        select(username, display_name, media_count)
        .select_from(media_assets.join(tweets, tweets.c.tweet_id == media_assets.c.tweet_id))
        .where(
            tweets.c.author_username.is_not(None),
            func.trim(tweets.c.author_username) != literal_column("''"),
        )
        .group_by(func.lower(tweets.c.author_username))
        .order_by(media_count.desc(), username.asc())
        .limit(bindparam("limit", limit))
    )
    if normalized_query:
        pattern = bindparam("author_query_pattern", f"%{normalized_query}%")
        statement = statement.where(
            or_(
                tweets.c.author_username.ilike(pattern),
                tweets.c.author_display_name.ilike(pattern),
            )
        )
    return compile_query(statement)


def search_post_feed(
    source_id: int | None = None,
    source_type: str | None = None,
    author_username: str | None = None,
    text: str | None = None,
    media_type: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[PostFeedRow], list[PostFeedMediaRow], int]:
    """查询帖子流，并同时取回已验证媒体与总数。"""

    page_sql, page_params = build_post_feed_query(
        source_id=source_id,
        source_type=source_type,
        author_username=author_username,
        text=text,
        media_type=media_type,
        limit=limit,
        offset=offset,
    )
    count_sql, count_params = build_post_feed_count_query(
        source_id=source_id,
        source_type=source_type,
        author_username=author_username,
        text=text,
        media_type=media_type,
    )
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(page_sql, page_params)
            posts = [PostFeedRow.model_validate(dict(row)) for row in cur.fetchall()]
            cur.execute(count_sql, count_params)
            total_count = int(cur.fetchone()["count"])
            if not posts:
                return posts, [], total_count
            media_sql, media_params = build_post_feed_media_query([row.tweet_id for row in posts])
            cur.execute(media_sql, media_params)
            media = [PostFeedMediaRow.model_validate(dict(row)) for row in cur.fetchall()]
    return posts, media, total_count


def build_post_feed_query(
    source_id: int | None = None,
    source_type: str | None = None,
    author_username: str | None = None,
    text: str | None = None,
    media_type: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> tuple[str, dict[str, object]]:
    """构造帖子流分页查询。"""

    statement = (
        select(
            tweets.c.tweet_id,
            tweets.c.url.label("tweet_url"),
            tweets.c.author_username,
            tweets.c.author_display_name,
            tweets.c.published_at,
            func.coalesce(tweets.c.text, literal_column("''")).label("tweet_text"),
            tweets.c.download_status.label("tweet_status"),
        )
        .where(*build_post_feed_conditions(source_id, source_type, author_username, text, media_type))
        .order_by(
            tweets.c.published_at.desc().nulls_last(),
            tweets.c.imported_at.desc(),
            tweets.c.tweet_id.desc(),
        )
        .limit(bindparam("limit", limit))
        .offset(bindparam("offset", offset))
    )
    return compile_query(statement)


def build_post_feed_count_query(
    source_id: int | None = None,
    source_type: str | None = None,
    author_username: str | None = None,
    text: str | None = None,
    media_type: str | None = None,
) -> tuple[str, dict[str, object]]:
    """构造帖子流数量查询。"""

    statement = select(func.count().cast(Integer).label("count")).select_from(tweets)
    statement = statement.where(
        *build_post_feed_conditions(source_id, source_type, author_username, text, media_type)
    )
    return compile_query(statement)


def build_post_feed_media_query(tweet_ids: list[str]) -> tuple[str, dict[str, object]]:
    """构造帖子流所需媒体列表查询。"""

    statement = (
        select(
            media_assets.c.id,
            media_assets.c.tweet_id,
            media_assets.c.media_index,
            media_assets.c.media_type,
            media_assets.c.download_status.label("media_status"),
            media_assets.c.source_engine,
            media_assets.c.local_path,
            media_assets.c.file_size,
            media_assets.c.width,
            media_assets.c.height,
            media_assets.c.duration_ms,
        )
        .where(
            media_assets.c.tweet_id.in_(tweet_ids),
            media_assets.c.download_status == bindparam("feed_media_status", "verified"),
        )
        .order_by(
            media_assets.c.tweet_id,
            media_assets.c.media_index.asc().nulls_last(),
            media_assets.c.id,
        )
    )
    return compile_query(statement)


def build_post_feed_conditions(
    source_id: int | None,
    source_type: str | None,
    author_username: str | None,
    text: str | None,
    media_type: str | None,
) -> list[ColumnElement[bool]]:
    """构造帖子流过滤条件。"""

    verified_media = select(media_assets.c.id).where(
        media_assets.c.tweet_id == tweets.c.tweet_id,
        media_assets.c.download_status == bindparam("post_media_status", "verified"),
    )
    conditions: list[ColumnElement[bool]] = [exists(verified_media)]

    normalized_username = str(author_username or "").strip().lstrip("@").strip().lower()
    if normalized_username:
        conditions.append(
            func.lower(tweets.c.author_username)
            == bindparam("post_author_username", normalized_username)
        )
    normalized_text = str(text or "").strip()
    if normalized_text:
        conditions.append(tweets.c.text.ilike(bindparam("post_text_pattern", f"%{normalized_text}%")))
    normalized_media_type = str(media_type or "").strip().lower()
    if normalized_media_type:
        matching_media = select(media_assets.c.id).where(
            media_assets.c.tweet_id == tweets.c.tweet_id,
            media_assets.c.download_status == bindparam("filter_media_status", "verified"),
            media_assets.c.media_type == bindparam("post_media_type", normalized_media_type),
        )
        conditions.append(exists(matching_media))

    normalized_source_type = str(source_type or "").strip().lower()
    if source_id is not None or normalized_source_type:
        membership = (
            select(source_discovered_tweets.c.id)
            .select_from(
                source_discovered_tweets.join(
                    archive_sources,
                    archive_sources.c.id == source_discovered_tweets.c.source_id,
                )
            )
            .where(source_discovered_tweets.c.tweet_id == tweets.c.tweet_id)
        )
        if source_id is not None:
            membership = membership.where(
                source_discovered_tweets.c.source_id == bindparam("post_source_id", source_id)
            )
        if normalized_source_type:
            membership = membership.where(
                archive_sources.c.source_type
                == bindparam("post_source_type", normalized_source_type)
            )
        conditions.append(exists(membership))
    return conditions


def compact_text(value: object, max_length: int = 90) -> str:
    """把长文本压成单行摘要，供命令行展示。"""

    text = " ".join(str(value or "").split())
    if len(text) <= max_length:
        return text
    return text[: max_length - 1] + "..."
