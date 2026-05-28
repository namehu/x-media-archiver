from __future__ import annotations

from xarchiver.db import connect


def search_media(
    author: str | None = None,
    text: str | None = None,
    tweet_status: str | None = None,
    media_status: str | None = "verified",
    media_type: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[dict[str, object]]:
    sql, params = build_search_query(author, text, tweet_status, media_status, media_type, limit, offset)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())


def count_search_media(
    author: str | None = None,
    text: str | None = None,
    tweet_status: str | None = None,
    media_status: str | None = "verified",
    media_type: str | None = None,
) -> int:
    where, params = build_search_filters(author, text, tweet_status, media_status, media_type)
    sql = """
        select count(*)::int as count
        from media_assets m
        join tweets t on t.tweet_id = m.tweet_id
    """
    if where:
        sql += "\n        where " + "\n          and ".join(where)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, tuple(params))
            return int(cur.fetchone()["count"])


def build_search_query(
    author: str | None,
    text: str | None,
    tweet_status: str | None,
    media_status: str | None,
    media_type: str | None,
    limit: int,
    offset: int = 0,
) -> tuple[str, tuple[object, ...]]:
    where, params = build_search_filters(author, text, tweet_status, media_status, media_type)

    sql = """
        select
            t.tweet_id,
            t.url as tweet_url,
            t.author_username,
            t.author_display_name,
            t.published_at,
            coalesce(t.text, '') as tweet_text,
            t.download_status as tweet_status,
            m.media_index,
            m.media_type,
            m.download_status as media_status,
            m.source_engine,
            m.local_path,
            m.file_size,
            m.width,
            m.height,
            m.duration_ms
        from media_assets m
        join tweets t on t.tweet_id = m.tweet_id
    """
    if where:
        sql += "\n        where " + "\n          and ".join(where)
    sql += "\n        order by t.published_at desc nulls last, t.imported_at desc, m.media_index nulls last, m.id"
    sql += "\n        limit %s offset %s"
    params.extend([limit, offset])

    return sql, tuple(params)


def build_search_filters(
    author: str | None,
    text: str | None,
    tweet_status: str | None,
    media_status: str | None,
    media_type: str | None,
) -> tuple[list[str], list[object]]:
    where: list[str] = []
    params: list[object] = []

    if author:
        where.append("(t.author_username ilike %s or t.author_display_name ilike %s)")
        pattern = f"%{author}%"
        params.extend([pattern, pattern])
    if text:
        where.append("t.text ilike %s")
        params.append(f"%{text}%")
    if tweet_status:
        where.append("t.download_status = %s")
        params.append(tweet_status)
    if media_status and media_status != "all":
        where.append("m.download_status = %s")
        params.append(media_status)
    if media_type:
        where.append("m.media_type = %s")
        params.append(media_type)
    return where, params


def compact_text(value: object, max_length: int = 90) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= max_length:
        return text
    return text[: max_length - 1] + "..."
