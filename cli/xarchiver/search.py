"""媒体检索与帖子流查询辅助函数。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Integer,
    and_,
    bindparam,
    case,
    exists,
    func,
    literal_column,
    or_,
    select,
)
from sqlalchemy.sql import ColumnElement, Select

from xarchiver.db import connect
from xarchiver.row_models import (
    AuthorOptionRow,
    PostFeedMediaRow,
    PostFeedRow,
    SearchMediaRow,
    TweetSearchCollectionOptionRow,
    TweetSearchLabelRow,
    TweetSearchNoteRow,
    TweetSearchRow,
    TweetSearchTagOptionRow,
)
from xarchiver.sql_builder import compile_query
from xarchiver.tables import (
    archive_sources,
    collection_tweets,
    collections,
    media_assets,
    source_discovered_tweets,
    tags,
    tweet_notes,
    tweet_search_documents,
    tweet_tags,
    tweets,
)


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
            .where(archive_sources.c.deleted_at.is_(None))
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


def search_tweet_library(
    query: str | None = None,
    source_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    media_type: str | None = None,
    tweet_status: str | None = "verified",
    tag_id: int | None = None,
    collection_id: int | None = None,
    sort: str = "auto",
    limit: int = 20,
    offset: int = 0,
) -> tuple[
    list[TweetSearchRow],
    list[PostFeedMediaRow],
    dict[str, dict[str, object]],
    int,
]:
    """以 Tweet 为单位执行全文、trigram 和结构化筛选查询。"""

    page_sql, page_params = build_tweet_library_search_query(
        query=query,
        source_id=source_id,
        date_from=date_from,
        date_to=date_to,
        media_type=media_type,
        tweet_status=tweet_status,
        tag_id=tag_id,
        collection_id=collection_id,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    count_sql, count_params = build_tweet_library_search_count_query(
        query=query,
        source_id=source_id,
        date_from=date_from,
        date_to=date_to,
        media_type=media_type,
        tweet_status=tweet_status,
        tag_id=tag_id,
        collection_id=collection_id,
    )
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(page_sql, page_params)
            rows = [TweetSearchRow.model_validate(dict(row)) for row in cur.fetchall()]
            cur.execute(count_sql, count_params)
            total_count = int(cur.fetchone()["count"])
            if not rows:
                return rows, [], {}, total_count

            tweet_ids = [row.tweet_id for row in rows]
            media_sql, media_params = build_post_feed_media_query(tweet_ids)
            cur.execute(media_sql, media_params)
            media = [PostFeedMediaRow.model_validate(dict(row)) for row in cur.fetchall()]
            organization = fetch_tweet_search_organization(cur, tweet_ids)
    return rows, media, organization, total_count


def build_tweet_library_search_query(
    query: str | None = None,
    source_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    media_type: str | None = None,
    tweet_status: str | None = "verified",
    tag_id: int | None = None,
    collection_id: int | None = None,
    sort: str = "auto",
    limit: int = 20,
    offset: int = 0,
) -> tuple[str, dict[str, object]]:
    """构造 Tweet 级全局搜索分页查询。"""

    normalized_query = str(query or "").strip()
    relevance = build_tweet_search_relevance(normalized_query).label("relevance")
    statement = (
        select(
            tweets.c.tweet_id,
            tweets.c.url.label("tweet_url"),
            tweets.c.author_username,
            tweets.c.author_display_name,
            tweets.c.published_at,
            func.coalesce(tweets.c.text, literal_column("''")).label("tweet_text"),
            tweets.c.download_status.label("tweet_status"),
            relevance,
        )
        .select_from(
            tweets.join(
                tweet_search_documents,
                tweet_search_documents.c.tweet_id == tweets.c.tweet_id,
            )
        )
        .where(
            *build_tweet_library_search_conditions(
                normalized_query,
                source_id,
                date_from,
                date_to,
                media_type,
                tweet_status,
                tag_id,
                collection_id,
            )
        )
        .limit(bindparam("limit", limit))
        .offset(bindparam("offset", offset))
    )

    resolved_sort = "relevance" if sort == "auto" and normalized_query else sort
    if resolved_sort == "relevance" and normalized_query:
        statement = statement.order_by(
            relevance.desc(),
            tweets.c.published_at.desc().nulls_last(),
            tweets.c.tweet_id.desc(),
        )
    elif resolved_sort == "oldest":
        statement = statement.order_by(
            tweets.c.published_at.asc().nulls_last(),
            tweets.c.imported_at.asc(),
            tweets.c.tweet_id.asc(),
        )
    else:
        statement = statement.order_by(
            tweets.c.published_at.desc().nulls_last(),
            tweets.c.imported_at.desc(),
            tweets.c.tweet_id.desc(),
        )
    return compile_query(statement)


def build_tweet_library_search_count_query(
    query: str | None = None,
    source_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    media_type: str | None = None,
    tweet_status: str | None = "verified",
    tag_id: int | None = None,
    collection_id: int | None = None,
) -> tuple[str, dict[str, object]]:
    """构造 Tweet 级全局搜索总数查询。"""

    normalized_query = str(query or "").strip()
    statement = (
        select(func.count().cast(Integer).label("count"))
        .select_from(
            tweets.join(
                tweet_search_documents,
                tweet_search_documents.c.tweet_id == tweets.c.tweet_id,
            )
        )
        .where(
            *build_tweet_library_search_conditions(
                normalized_query,
                source_id,
                date_from,
                date_to,
                media_type,
                tweet_status,
                tag_id,
                collection_id,
            )
        )
    )
    return compile_query(statement)


def build_tweet_search_relevance(query: str) -> ColumnElement[float]:
    """组合全文相关度、子串命中和 trigram 相似度。"""

    if not query:
        return literal_column("0.0")
    normalized_document = func.lower(tweet_search_documents.c.search_text)
    substring_match = normalized_document.like(
        bindparam("search_substring_pattern", literal_contains_pattern(query)),
        escape="!",
    )
    if requires_literal_substring(query):
        return case((substring_match, 1.0), else_=0.0)

    query_param = bindparam("search_query", query)
    ts_query = func.websearch_to_tsquery(literal_column("'simple'::regconfig"), query_param)
    return (
        func.ts_rank_cd(tweet_search_documents.c.search_vector, ts_query) * 2.0
        + case((substring_match, 1.0), else_=0.0)
        + func.word_similarity(func.lower(query_param), normalized_document)
    )


def build_tweet_library_search_conditions(
    query: str,
    source_id: int | None,
    date_from: datetime | None,
    date_to: datetime | None,
    media_type: str | None,
    tweet_status: str | None,
    tag_id: int | None,
    collection_id: int | None,
) -> list[ColumnElement[bool]]:
    """构造全局搜索的文本与结构化条件。"""

    conditions: list[ColumnElement[bool]] = []
    if query:
        query_param = bindparam("search_query", query)
        normalized_document = func.lower(tweet_search_documents.c.search_text)
        ts_query = func.websearch_to_tsquery(literal_column("'simple'::regconfig"), query_param)
        substring_match = normalized_document.like(
            bindparam("search_substring_pattern", literal_contains_pattern(query)),
            escape="!",
        )
        if requires_literal_substring(query):
            conditions.append(substring_match)
        else:
            conditions.append(
                or_(
                    tweet_search_documents.c.search_vector.op("@@")(ts_query),
                    substring_match,
                    func.lower(query_param).op("<%")(normalized_document),
                )
            )
    if source_id is not None:
        source_membership = (
            select(source_discovered_tweets.c.id)
            .select_from(
                source_discovered_tweets.join(
                    archive_sources,
                    archive_sources.c.id == source_discovered_tweets.c.source_id,
                )
            )
            .where(
                source_discovered_tweets.c.tweet_id == tweets.c.tweet_id,
                source_discovered_tweets.c.source_id == bindparam("search_source_id", source_id),
                archive_sources.c.deleted_at.is_(None),
            )
        )
        conditions.append(exists(source_membership))
    if date_from is not None:
        conditions.append(tweets.c.published_at >= bindparam("search_date_from", date_from))
    if date_to is not None:
        conditions.append(tweets.c.published_at < bindparam("search_date_to", date_to))
    if media_type:
        matching_media = select(media_assets.c.id).where(
            media_assets.c.tweet_id == tweets.c.tweet_id,
            media_assets.c.media_type == bindparam("search_media_type", media_type),
        )
        conditions.append(exists(matching_media))
    if tweet_status and tweet_status != "all":
        conditions.append(
            tweets.c.download_status == bindparam("search_tweet_status", tweet_status)
        )
    if tag_id is not None:
        conditions.append(
            exists(
                select(tweet_tags.c.tweet_id).where(
                    tweet_tags.c.tweet_id == tweets.c.tweet_id,
                    tweet_tags.c.tag_id == bindparam("search_tag_id", tag_id),
                )
            )
        )
    if collection_id is not None:
        conditions.append(
            exists(
                select(collection_tweets.c.tweet_id).where(
                    collection_tweets.c.tweet_id == tweets.c.tweet_id,
                    collection_tweets.c.collection_id
                    == bindparam("search_collection_id", collection_id),
                )
            )
        )
    return conditions


def literal_contains_pattern(value: str) -> str:
    """构造使用 ``!`` 转义的 LIKE 子串模式，保留用户输入的字面语义。"""

    escaped = value.lower().replace("!", "!!").replace("%", "!%").replace("_", "!_")
    return f"%{escaped}%"


def requires_literal_substring(value: str) -> bool:
    """含 SQL LIKE 通配符的用户输入必须整体按字面子串解释。"""

    return "%" in value or "_" in value


def fetch_tweet_search_organization(
    cursor: object,
    tweet_ids: list[str],
) -> dict[str, dict[str, object]]:
    """批量读取搜索结果所需的标签、合集和备注摘要。"""

    result = {
        tweet_id: {"tags": [], "collections": [], "note_excerpt": None}
        for tweet_id in tweet_ids
    }

    tag_statement = (
        select(tweet_tags.c.tweet_id, tags.c.name)
        .select_from(tweet_tags.join(tags, tags.c.id == tweet_tags.c.tag_id))
        .where(tweet_tags.c.tweet_id.in_(tweet_ids))
        .order_by(tweet_tags.c.tweet_id, tags.c.normalized_name)
    )
    sql, params = compile_query(tag_statement)
    cursor.execute(sql, params)
    for row in (TweetSearchLabelRow.model_validate(dict(value)) for value in cursor.fetchall()):
        result[row.tweet_id]["tags"].append(row.name)

    collection_statement = (
        select(collection_tweets.c.tweet_id, collections.c.name)
        .select_from(
            collection_tweets.join(
                collections,
                collections.c.id == collection_tweets.c.collection_id,
            )
        )
        .where(collection_tweets.c.tweet_id.in_(tweet_ids))
        .order_by(collection_tweets.c.tweet_id, collections.c.normalized_name)
    )
    sql, params = compile_query(collection_statement)
    cursor.execute(sql, params)
    for row in (TweetSearchLabelRow.model_validate(dict(value)) for value in cursor.fetchall()):
        result[row.tweet_id]["collections"].append(row.name)

    note_statement = select(
        tweet_notes.c.tweet_id,
        func.substr(tweet_notes.c.content, 1, 240).label("note_excerpt"),
    ).where(tweet_notes.c.tweet_id.in_(tweet_ids))
    sql, params = compile_query(note_statement)
    cursor.execute(sql, params)
    for row in (TweetSearchNoteRow.model_validate(dict(value)) for value in cursor.fetchall()):
        result[row.tweet_id]["note_excerpt"] = row.note_excerpt
    return result


def list_tweet_search_options() -> tuple[
    list[TweetSearchTagOptionRow],
    list[TweetSearchCollectionOptionRow],
]:
    """返回全局搜索筛选器使用的标签与合集候选项。"""

    tag_count = func.count(tweet_tags.c.tweet_id).cast(Integer).label("tweet_count")
    tag_statement = (
        select(tags.c.id, tags.c.name, tags.c.color, tag_count)
        .select_from(tags.outerjoin(tweet_tags, tweet_tags.c.tag_id == tags.c.id))
        .group_by(tags.c.id, tags.c.name, tags.c.color, tags.c.normalized_name)
        .order_by(tag_count.desc(), tags.c.normalized_name)
    )
    collection_count = (
        func.count(collection_tweets.c.tweet_id).cast(Integer).label("tweet_count")
    )
    collection_statement = (
        select(collections.c.id, collections.c.name, collection_count)
        .select_from(
            collections.outerjoin(
                collection_tweets,
                collection_tweets.c.collection_id == collections.c.id,
            )
        )
        .group_by(
            collections.c.id,
            collections.c.name,
            collections.c.normalized_name,
        )
        .order_by(collection_count.desc(), collections.c.normalized_name)
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(tag_statement)
            cur.execute(sql, params)
            tag_rows = [
                TweetSearchTagOptionRow.model_validate(dict(row))
                for row in cur.fetchall()
            ]
            sql, params = compile_query(collection_statement)
            cur.execute(sql, params)
            collection_rows = [
                TweetSearchCollectionOptionRow.model_validate(dict(row))
                for row in cur.fetchall()
            ]
    return tag_rows, collection_rows


def compact_text(value: object, max_length: int = 90) -> str:
    """把长文本压成单行摘要，供命令行展示。"""

    text = " ".join(str(value or "").split())
    if len(text) <= max_length:
        return text
    return text[: max_length - 1] + "..."
