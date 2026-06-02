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
from xarchiver.row_models import SearchMediaRow
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
) -> list[SearchMediaRow]:
    sql, params = build_search_query(author, text, tweet_status, media_status, media_type, limit, offset)
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
) -> int:
    sql, params = build_count_query(author, text, tweet_status, media_status, media_type)
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
) -> tuple[str, dict[str, object]]:
    statement = (
        select(
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
    statement = apply_search_filters(statement, author, text, tweet_status, media_status, media_type)
    return compile_query(statement)


def build_count_query(
    author: str | None,
    text: str | None,
    tweet_status: str | None,
    media_status: str | None,
    media_type: str | None,
) -> tuple[str, dict[str, object]]:
    statement = select(func.count().cast(Integer).label("count")).select_from(
        media_assets.join(tweets, tweets.c.tweet_id == media_assets.c.tweet_id)
    )
    statement = apply_search_filters(statement, author, text, tweet_status, media_status, media_type)
    return compile_query(statement)


def apply_search_filters(
    statement: Select,
    author: str | None,
    text: str | None,
    tweet_status: str | None,
    media_status: str | None,
    media_type: str | None,
) -> Select:
    conditions = build_search_conditions(author, text, tweet_status, media_status, media_type)
    if not conditions:
        return statement
    return statement.where(and_(*conditions))


def build_search_conditions(
    author: str | None,
    text: str | None,
    tweet_status: str | None,
    media_status: str | None,
    media_type: str | None,
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
    if text:
        conditions.append(tweets.c.text.ilike(bindparam("text_pattern", f"%{text}%")))
    if tweet_status:
        conditions.append(tweets.c.download_status == bindparam("tweet_status", tweet_status))
    if media_status and media_status != "all":
        conditions.append(media_assets.c.download_status == bindparam("media_status", media_status))
    if media_type:
        conditions.append(media_assets.c.media_type == bindparam("media_type", media_type))
    return conditions



def compact_text(value: object, max_length: int = 90) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= max_length:
        return text
    return text[: max_length - 1] + "..."
