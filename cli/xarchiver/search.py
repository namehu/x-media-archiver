from __future__ import annotations

from sqlalchemy import (
    Integer,
    and_,
    bindparam,
    func,
    literal_column,
    or_,
    select,
)
from sqlalchemy.sql import ColumnElement, Select

from xarchiver.db import connect
from xarchiver.row_models import AuthorOptionRow, SearchMediaRow
from xarchiver.sql_builder import compile_query
from xarchiver.tables import media_assets, tweets


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
    sql, params = build_author_options_query(query, limit)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [AuthorOptionRow.model_validate(dict(row)) for row in cur.fetchall()]


def build_author_options_query(
    query: str | None,
    limit: int,
) -> tuple[str, dict[str, object]]:
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


def compact_text(value: object, max_length: int = 90) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= max_length:
        return text
    return text[: max_length - 1] + "..."
