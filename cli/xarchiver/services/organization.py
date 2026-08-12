"""Tweet 标签、合集和私人备注的查询、写入与审计服务。"""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path

from psycopg.errors import UniqueViolation
from psycopg.types.json import Jsonb
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as postgresql_insert

from xarchiver.core.events import publish_event
from xarchiver.db import connect
from xarchiver.sql_builder import compile_query
from xarchiver.tables import (
    collection_tweets,
    collections,
    media_assets,
    organization_action_events,
    tags,
    tweet_notes,
    tweet_tags,
    tweets,
)

MAX_ORGANIZATION_TWEETS = 200
MAX_NAME_LENGTH = 100
MAX_DESCRIPTION_LENGTH = 500
MAX_NOTE_LENGTH = 10_000
COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")


def list_organization_catalog(archive_dir: Path) -> dict[str, object]:
    """返回标签、合集、影响数量和合集封面。"""

    tag_count = func.count(tweet_tags.c.tweet_id).label("tweet_count")
    tag_statement = (
        select(
            tags.c.id,
            tags.c.name,
            tags.c.normalized_name,
            tags.c.color,
            tags.c.description,
            tags.c.created_at,
            tags.c.updated_at,
            tag_count,
        )
        .select_from(tags.outerjoin(tweet_tags, tweet_tags.c.tag_id == tags.c.id))
        .group_by(tags.c.id)
        .order_by(tags.c.normalized_name)
    )
    collection_count = func.count(collection_tweets.c.tweet_id).label("tweet_count")
    collection_statement = (
        select(
            collections.c.id,
            collections.c.name,
            collections.c.normalized_name,
            collections.c.description,
            collections.c.cover_media_id,
            collections.c.created_at,
            collections.c.updated_at,
            collection_count,
            media_assets.c.media_type.label("cover_media_type"),
            media_assets.c.local_path.label("cover_local_path"),
        )
        .select_from(
            collections.outerjoin(
                collection_tweets,
                collection_tweets.c.collection_id == collections.c.id,
            ).outerjoin(media_assets, media_assets.c.id == collections.c.cover_media_id)
        )
        .group_by(collections.c.id, media_assets.c.id)
        .order_by(collections.c.normalized_name)
    )
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(*compile_query(tag_statement))
            tag_rows = [dict(row) for row in cur.fetchall()]
            cur.execute(*compile_query(collection_statement))
            collection_rows = [dict(row) for row in cur.fetchall()]
    for row in collection_rows:
        row["cover"] = _cover_payload(row, archive_dir)
        row.pop("cover_media_type", None)
        row.pop("cover_local_path", None)
    return {"tags": tag_rows, "collections": collection_rows}


def get_tweet_organization(tweet_id: str) -> dict[str, object] | None:
    """返回单条 Tweet 的完整整理信息。"""

    with connect() as conn:
        with conn.cursor() as cur:
            if not _tweet_exists(cur, tweet_id):
                return None
            tag_statement = (
                select(
                    tags.c.id,
                    tags.c.name,
                    tags.c.normalized_name,
                    tags.c.color,
                    tags.c.description,
                    tags.c.created_at,
                    tags.c.updated_at,
                )
                .select_from(tweet_tags.join(tags, tags.c.id == tweet_tags.c.tag_id))
                .where(tweet_tags.c.tweet_id == tweet_id)
                .order_by(tags.c.normalized_name)
            )
            cur.execute(*compile_query(tag_statement))
            tag_rows = [dict(row) for row in cur.fetchall()]
            collection_statement = (
                select(
                    collections.c.id,
                    collections.c.name,
                    collections.c.normalized_name,
                    collections.c.description,
                    collections.c.cover_media_id,
                    collections.c.created_at,
                    collections.c.updated_at,
                )
                .select_from(
                    collection_tweets.join(
                        collections,
                        collections.c.id == collection_tweets.c.collection_id,
                    )
                )
                .where(collection_tweets.c.tweet_id == tweet_id)
                .order_by(collections.c.normalized_name)
            )
            cur.execute(*compile_query(collection_statement))
            collection_rows = [dict(row) for row in cur.fetchall()]
            note_statement = select(
                tweet_notes.c.content,
                tweet_notes.c.created_at,
                tweet_notes.c.updated_at,
            ).where(tweet_notes.c.tweet_id == tweet_id)
            cur.execute(*compile_query(note_statement))
            note = cur.fetchone()
    return {
        "tweet_id": tweet_id,
        "tags": tag_rows,
        "collections": collection_rows,
        "note": dict(note) if note else None,
    }


def create_tag(name: str, color: str | None = None, description: str | None = None) -> dict[str, object]:
    """创建一个大小写不敏感唯一的平面标签。"""

    values = _tag_values(name, color, description)
    statement = (
        insert(tags)
        .values(**values)
        .returning(tags.c.id, tags.c.name, tags.c.normalized_name, tags.c.color, tags.c.description)
    )
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(*compile_query(statement))
                row = dict(cur.fetchone())
                _insert_audit(cur, "tag_created", "tag", str(row["id"]), [], {"name": row["name"]})
            conn.commit()
    except UniqueViolation as exc:
        raise ValueError("tag_name_exists") from exc
    publish_event("library", "library.organization_updated", {"tag_id": row["id"]})
    return row


def update_tag(tag_id: int, name: str, color: str | None, description: str | None) -> dict[str, object]:
    """更新标签元数据。"""

    values = {**_tag_values(name, color, description), "updated_at": func.now()}
    statement = (
        update(tags)
        .where(tags.c.id == tag_id)
        .values(**values)
        .returning(tags.c.id, tags.c.name, tags.c.normalized_name, tags.c.color, tags.c.description)
    )
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(*compile_query(statement))
                value = cur.fetchone()
                if value is None:
                    raise ValueError("tag_not_found")
                row = dict(value)
                _insert_audit(cur, "tag_updated", "tag", str(tag_id), [], {"name": row["name"]})
            conn.commit()
    except UniqueViolation as exc:
        raise ValueError("tag_name_exists") from exc
    publish_event("library", "library.organization_updated", {"tag_id": tag_id})
    return row


def delete_tag(tag_id: int, *, confirmed: bool) -> dict[str, object]:
    """删除标签及关联；Tweet 与媒体保持不变。"""

    if not confirmed:
        raise ValueError("organization_delete_confirmation_required")
    with connect() as conn:
        with conn.cursor() as cur:
            target = _lock_named_target(cur, tags, tag_id)
            if target is None:
                raise ValueError("tag_not_found")
            affected_ids = _linked_tweet_ids(cur, tweet_tags.c.tweet_id, tweet_tags.c.tag_id, tag_id)
            cur.execute(*compile_query(delete(tags).where(tags.c.id == tag_id)))
            _insert_audit(
                cur,
                "tag_deleted",
                "tag",
                str(tag_id),
                affected_ids,
                {"name": target["name"], "affected_tweet_count": len(affected_ids)},
            )
        conn.commit()
    publish_event("library", "library.organization_updated", {"tag_id": tag_id, "deleted": True})
    return {"id": tag_id, "affected_tweet_count": len(affected_ids), "tweets_deleted": 0, "media_deleted": 0}


def create_collection(name: str, description: str | None = None) -> dict[str, object]:
    """创建手工合集。"""

    values = _collection_values(name, description)
    statement = (
        insert(collections)
        .values(**values)
        .returning(collections.c.id, collections.c.name, collections.c.normalized_name, collections.c.description)
    )
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(*compile_query(statement))
                row = dict(cur.fetchone())
                _insert_audit(
                    cur,
                    "collection_created",
                    "collection",
                    str(row["id"]),
                    [],
                    {"name": row["name"]},
                )
            conn.commit()
    except UniqueViolation as exc:
        raise ValueError("collection_name_exists") from exc
    publish_event("library", "library.organization_updated", {"collection_id": row["id"]})
    return row


def update_collection(
    collection_id: int,
    name: str,
    description: str | None,
    cover_media_id: int | None,
) -> dict[str, object]:
    """更新合集，并确保封面来自该合集现有 Tweet。"""

    values = {
        **_collection_values(name, description),
        "cover_media_id": cover_media_id,
        "updated_at": func.now(),
    }
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                if cover_media_id is not None and not _cover_belongs_to_collection(
                    cur,
                    collection_id,
                    cover_media_id,
                ):
                    raise ValueError("collection_cover_not_member")
                statement = (
                    update(collections)
                    .where(collections.c.id == collection_id)
                    .values(**values)
                    .returning(
                        collections.c.id,
                        collections.c.name,
                        collections.c.normalized_name,
                        collections.c.description,
                        collections.c.cover_media_id,
                    )
                )
                cur.execute(*compile_query(statement))
                value = cur.fetchone()
                if value is None:
                    raise ValueError("collection_not_found")
                row = dict(value)
                _insert_audit(
                    cur,
                    "collection_updated",
                    "collection",
                    str(collection_id),
                    [],
                    {"name": row["name"], "cover_media_id": cover_media_id},
                )
            conn.commit()
    except UniqueViolation as exc:
        raise ValueError("collection_name_exists") from exc
    publish_event("library", "library.organization_updated", {"collection_id": collection_id})
    return row


def delete_collection(collection_id: int, *, confirmed: bool) -> dict[str, object]:
    """删除合集及成员关系；Tweet 与媒体保持不变。"""

    if not confirmed:
        raise ValueError("organization_delete_confirmation_required")
    with connect() as conn:
        with conn.cursor() as cur:
            target = _lock_named_target(cur, collections, collection_id)
            if target is None:
                raise ValueError("collection_not_found")
            affected_ids = _linked_tweet_ids(
                cur,
                collection_tweets.c.tweet_id,
                collection_tweets.c.collection_id,
                collection_id,
            )
            cur.execute(*compile_query(delete(collections).where(collections.c.id == collection_id)))
            _insert_audit(
                cur,
                "collection_deleted",
                "collection",
                str(collection_id),
                affected_ids,
                {"name": target["name"], "affected_tweet_count": len(affected_ids)},
            )
        conn.commit()
    publish_event(
        "library",
        "library.organization_updated",
        {"collection_id": collection_id, "deleted": True},
    )
    return {
        "id": collection_id,
        "affected_tweet_count": len(affected_ids),
        "tweets_deleted": 0,
        "media_deleted": 0,
    }


def replace_tweet_labels(tweet_id: str, tag_ids: list[int], collection_ids: list[int]) -> dict[str, object]:
    """用精确集合替换单条 Tweet 的标签与合集。"""

    normalized_tags = _normalize_ids(tag_ids)
    normalized_collections = _normalize_ids(collection_ids)
    with connect() as conn:
        with conn.cursor() as cur:
            _lock_tweets(cur, [tweet_id])
            _validate_target_ids(cur, tags, normalized_tags, "tags_not_found")
            _validate_target_ids(cur, collections, normalized_collections, "collections_not_found")
            cur.execute(*compile_query(delete(tweet_tags).where(tweet_tags.c.tweet_id == tweet_id)))
            cur.execute(
                *compile_query(delete(collection_tweets).where(collection_tweets.c.tweet_id == tweet_id))
            )
            _insert_link_rows(cur, tweet_tags, tweet_id, normalized_tags, "tag_id")
            _insert_link_rows(cur, collection_tweets, tweet_id, normalized_collections, "collection_id")
            _clear_invalid_collection_covers(cur)
            _insert_audit(
                cur,
                "tweet_labels_updated",
                "tweet",
                tweet_id,
                [tweet_id],
                {"tag_ids": normalized_tags, "collection_ids": normalized_collections},
            )
        conn.commit()
    publish_event("library", "library.organization_updated", {"tweet_ids": [tweet_id]})
    result = get_tweet_organization(tweet_id)
    assert result is not None
    return result


def save_tweet_note(tweet_id: str, content: str) -> dict[str, object]:
    """保存或清空单条纯文本私人备注。"""

    normalized = str(content).strip()
    if len(normalized) > MAX_NOTE_LENGTH:
        raise ValueError("tweet_note_too_long")
    with connect() as conn:
        with conn.cursor() as cur:
            _lock_tweets(cur, [tweet_id])
            if normalized:
                statement = postgresql_insert(tweet_notes).values(tweet_id=tweet_id, content=normalized)
                statement = statement.on_conflict_do_update(
                    index_elements=[tweet_notes.c.tweet_id],
                    set_={"content": normalized, "updated_at": func.now()},
                ).returning(tweet_notes.c.content, tweet_notes.c.created_at, tweet_notes.c.updated_at)
                cur.execute(*compile_query(statement))
                note = dict(cur.fetchone())
            else:
                cur.execute(*compile_query(delete(tweet_notes).where(tweet_notes.c.tweet_id == tweet_id)))
                note = None
            _insert_audit(
                cur,
                "tweet_note_updated",
                "tweet",
                tweet_id,
                [tweet_id],
                {"has_note": bool(normalized), "content_length": len(normalized)},
            )
        conn.commit()
    publish_event("library", "library.organization_updated", {"tweet_ids": [tweet_id]})
    return {"tweet_id": tweet_id, "note": note}


def bulk_update_labels(
    tweet_ids: list[str],
    *,
    add_tag_ids: list[int],
    remove_tag_ids: list[int],
    add_collection_ids: list[int],
    remove_collection_ids: list[int],
) -> dict[str, object]:
    """对最多 200 条精确 Tweet 批量加减标签与合集。"""

    selected = _normalize_tweet_ids(tweet_ids)
    add_tags = _normalize_ids(add_tag_ids)
    remove_tags = _normalize_ids(remove_tag_ids)
    add_collections = _normalize_ids(add_collection_ids)
    remove_collections = _normalize_ids(remove_collection_ids)
    if set(add_tags) & set(remove_tags) or set(add_collections) & set(remove_collections):
        raise ValueError("organization_bulk_conflicting_changes")
    if not (add_tags or remove_tags or add_collections or remove_collections):
        raise ValueError("organization_bulk_changes_required")
    with connect() as conn:
        with conn.cursor() as cur:
            _lock_tweets(cur, selected)
            _validate_target_ids(cur, tags, add_tags + remove_tags, "tags_not_found")
            _validate_target_ids(cur, collections, add_collections + remove_collections, "collections_not_found")
            added_tags = _bulk_insert_links(cur, tweet_tags, selected, add_tags, "tag_id")
            removed_tags = _bulk_delete_links(cur, tweet_tags, selected, remove_tags, "tag_id")
            added_collections = _bulk_insert_links(
                cur,
                collection_tweets,
                selected,
                add_collections,
                "collection_id",
            )
            removed_collections = _bulk_delete_links(
                cur,
                collection_tweets,
                selected,
                remove_collections,
                "collection_id",
            )
            _clear_invalid_collection_covers(cur)
            details = {
                "added_tag_links": added_tags,
                "removed_tag_links": removed_tags,
                "added_collection_links": added_collections,
                "removed_collection_links": removed_collections,
            }
            _insert_audit(cur, "bulk_labels_updated", "tweet_selection", None, selected, details)
        conn.commit()
    publish_event("library", "library.organization_updated", {"tweet_ids": selected})
    return {"selected_tweet_count": len(selected), **details}


def collection_page_metadata(collection_id: int) -> tuple[dict[str, object], int]:
    """返回合集元数据与成员总数。"""

    with connect() as conn:
        with conn.cursor() as cur:
            target_statement = select(
                collections.c.id,
                collections.c.name,
                collections.c.normalized_name,
                collections.c.description,
                collections.c.cover_media_id,
                collections.c.created_at,
                collections.c.updated_at,
            ).where(collections.c.id == collection_id)
            cur.execute(*compile_query(target_statement))
            target = cur.fetchone()
            if target is None:
                raise ValueError("collection_not_found")
            count_statement = select(func.count().label("count")).select_from(collection_tweets).where(
                collection_tweets.c.collection_id == collection_id
            )
            cur.execute(*compile_query(count_statement))
            total = int(cur.fetchone()["count"])
    return dict(target), total


def _tag_values(name: str, color: str | None, description: str | None) -> dict[str, object]:
    normalized_name = _required_text(name, MAX_NAME_LENGTH, "tag_name_invalid")
    normalized_color = str(color).strip().lower() if color else None
    if normalized_color and not COLOR_PATTERN.fullmatch(normalized_color):
        raise ValueError("tag_color_invalid")
    return {
        "name": normalized_name,
        "color": normalized_color,
        "description": _optional_text(description, MAX_DESCRIPTION_LENGTH, "tag_description_too_long"),
    }


def _collection_values(name: str, description: str | None) -> dict[str, object]:
    return {
        "name": _required_text(name, MAX_NAME_LENGTH, "collection_name_invalid"),
        "description": _optional_text(
            description,
            MAX_DESCRIPTION_LENGTH,
            "collection_description_too_long",
        ),
    }


def _required_text(value: str, maximum: int, code: str) -> str:
    normalized = str(value).strip()
    if not normalized or len(normalized) > maximum:
        raise ValueError(code)
    return normalized


def _optional_text(value: str | None, maximum: int, code: str) -> str | None:
    normalized = str(value or "").strip()
    if len(normalized) > maximum:
        raise ValueError(code)
    return normalized or None


def _normalize_ids(values: Iterable[int]) -> list[int]:
    return list(dict.fromkeys(int(value) for value in values))


def _normalize_tweet_ids(values: Iterable[str]) -> list[str]:
    selected = list(dict.fromkeys(str(value).strip() for value in values if str(value).strip()))
    if not selected or len(selected) > MAX_ORGANIZATION_TWEETS:
        raise ValueError("invalid_organization_tweet_selection")
    return selected


def _tweet_exists(cur: object, tweet_id: str) -> bool:
    cur.execute(*compile_query(select(tweets.c.tweet_id).where(tweets.c.tweet_id == tweet_id)))
    return cur.fetchone() is not None


def _lock_tweets(cur: object, tweet_ids: list[str]) -> None:
    statement = select(tweets.c.tweet_id).where(tweets.c.tweet_id.in_(tweet_ids)).with_for_update()
    cur.execute(*compile_query(statement))
    found = {str(row["tweet_id"]) for row in cur.fetchall()}
    if found != set(tweet_ids):
        raise ValueError("tweets_not_found")


def _validate_target_ids(cur: object, table: object, ids: list[int], code: str) -> None:
    expected = set(ids)
    if not expected:
        return
    cur.execute(*compile_query(select(table.c.id).where(table.c.id.in_(expected))))
    found = {int(row["id"]) for row in cur.fetchall()}
    if found != expected:
        raise ValueError(code)


def _insert_link_rows(cur: object, table: object, tweet_id: str, ids: list[int], id_column: str) -> None:
    if not ids:
        return
    rows = [{"tweet_id": tweet_id, id_column: value} for value in ids]
    statement = postgresql_insert(table).values(rows).on_conflict_do_nothing()
    cur.execute(*compile_query(statement))


def _bulk_insert_links(cur: object, table: object, tweet_ids: list[str], ids: list[int], id_column: str) -> int:
    if not ids:
        return 0
    rows = [{"tweet_id": tweet_id, id_column: value} for tweet_id in tweet_ids for value in ids]
    statement = postgresql_insert(table).values(rows).on_conflict_do_nothing()
    cur.execute(*compile_query(statement))
    return int(cur.rowcount)


def _bulk_delete_links(cur: object, table: object, tweet_ids: list[str], ids: list[int], id_column: str) -> int:
    if not ids:
        return 0
    statement = delete(table).where(table.c.tweet_id.in_(tweet_ids), table.c[id_column].in_(ids))
    cur.execute(*compile_query(statement))
    return int(cur.rowcount)


def _lock_named_target(cur: object, table: object, target_id: int) -> dict[str, object] | None:
    cur.execute(*compile_query(select(table.c.id, table.c.name).where(table.c.id == target_id).with_for_update()))
    row = cur.fetchone()
    return dict(row) if row else None


def _linked_tweet_ids(cur: object, tweet_column: object, target_column: object, target_id: int) -> list[str]:
    cur.execute(*compile_query(select(tweet_column).where(target_column == target_id).order_by(tweet_column)))
    return [str(row["tweet_id"]) for row in cur.fetchall()]


def _cover_belongs_to_collection(cur: object, collection_id: int, media_id: int) -> bool:
    statement = (
        select(media_assets.c.id)
        .select_from(
            media_assets.join(
                collection_tweets,
                collection_tweets.c.tweet_id == media_assets.c.tweet_id,
            )
        )
        .where(media_assets.c.id == media_id, collection_tweets.c.collection_id == collection_id)
    )
    cur.execute(*compile_query(statement))
    return cur.fetchone() is not None


def _clear_invalid_collection_covers(cur: object) -> None:
    # Correlated EXISTS is expressed with SQLAlchemy Core; clearing the cover
    # never deletes the underlying media record.
    member_cover = (
        select(media_assets.c.id)
        .select_from(
            media_assets.join(
                collection_tweets,
                collection_tweets.c.tweet_id == media_assets.c.tweet_id,
            )
        )
        .where(
            media_assets.c.id == collections.c.cover_media_id,
            collection_tweets.c.collection_id == collections.c.id,
        )
    )
    statement = (
        update(collections)
        .where(collections.c.cover_media_id.is_not(None), ~member_cover.exists())
        .values(cover_media_id=None, updated_at=func.now())
    )
    cur.execute(*compile_query(statement))


def _insert_audit(
    cur: object,
    action: str,
    target_type: str,
    target_id: str | None,
    tweet_ids: list[str],
    details: dict[str, object],
) -> None:
    statement = insert(organization_action_events).values(
        action=action,
        target_type=target_type,
        target_id=target_id,
        tweet_ids=Jsonb(tweet_ids),
        details=Jsonb(details),
    )
    cur.execute(*compile_query(statement))


def _cover_payload(row: dict[str, object], archive_dir: Path) -> dict[str, object] | None:
    media_id = row.get("cover_media_id")
    local_path = row.get("cover_local_path")
    if not media_id or not local_path:
        return None
    archive_root = archive_dir.resolve()
    candidate = Path(str(local_path))
    if not candidate.is_absolute():
        candidate = archive_root / candidate
    resolved = candidate.resolve()
    if archive_root != resolved and archive_root not in resolved.parents:
        return None
    relative_path = resolved.relative_to(archive_root).as_posix()
    preview_path = relative_path
    if row.get("cover_media_type") == "video":
        media_path = archive_dir / relative_path
        candidate = media_path.with_name(f"{media_path.stem}.preview.jpg")
        preview_path = (
            candidate.relative_to(archive_dir).as_posix()
            if candidate.is_file() and archive_dir in candidate.parents
            else relative_path
        )
    return {
        "id": int(media_id),
        "media_type": row.get("cover_media_type"),
        "media_url": f"/api/v1/media-file/{preview_path}",
    }
