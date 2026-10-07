"""显式拆分旧媒体来源；默认只读预览，绝不迁移旧发现或游标。"""

from typing import Any

from psycopg.errors import UniqueViolation
from psycopg.types.json import Jsonb
from sqlalchemy import func, insert, or_, select, update

from xarchiver.core.events import publish_event
from xarchiver.db import connect
from xarchiver.row_models import ArchiveSourceRow, SourceMediaSplitRow
from xarchiver.services.source_types import LEGACY_MEDIA_SOURCE_TYPE, media_source_url
from xarchiver.services.sources import (
    SOURCE_DELETE_BLOCKING_RUN_STATUSES,
    SOURCE_DELETE_BLOCKING_SCAN_STATUSES,
    infer_author_username,
    normalize_source_url,
    set_active_scan_session_state,
)
from xarchiver.sql_builder import compile_query
from xarchiver.tables import (
    archive_run_items,
    archive_runs,
    archive_sources,
    source_bulk_task_items,
    source_bulk_tasks,
    source_discovered_tweets,
    source_media_splits,
    source_scan_runs,
    source_schedule_policies,
    source_schedule_policy_sources,
)


def _count(cur: Any, table: Any, *conditions: Any) -> int:
    cur.execute(
        *compile_query(select(func.count().label("count")).select_from(table).where(*conditions))
    )
    return int(cur.fetchone()["count"])


def _preview(cur: Any, source: ArchiveSourceRow) -> dict[str, Any]:
    source_id = source.id
    url = normalize_source_url(source.source_url or "")
    targets = [
        {"source_type": kind, "source_url": media_source_url(kind, url)}
        for kind in ("user_photos", "user_videos")
    ]
    cur.execute(
        *compile_query(
            select(source_media_splits).where(source_media_splits.c.old_source_id == source_id)
        )
    )
    mapping = cur.fetchone()
    if mapping:
        split = SourceMediaSplitRow.model_validate(dict(mapping))
        return {
            "old_source_id": source_id,
            "status": "already_split",
            "mapping": split.model_dump(mode="json"),
        }
    if source.source_type != LEGACY_MEDIA_SOURCE_TYPE:
        raise ValueError("source_is_not_legacy_media")
    blockers = {
        "active_scans": _count(
            cur,
            source_scan_runs,
            source_scan_runs.c.source_id == source_id,
            source_scan_runs.c.status.in_(sorted(SOURCE_DELETE_BLOCKING_SCAN_STATUSES)),
        ),
        "active_download_runs": _count(
            cur,
            archive_runs,
            archive_runs.c.source_id == source_id,
            archive_runs.c.status.in_(sorted(SOURCE_DELETE_BLOCKING_RUN_STATUSES)),
        ),
        "processing_download_items": _count(
            cur,
            archive_run_items.join(
                archive_runs, archive_run_items.c.archive_run_id == archive_runs.c.id
            ),
            archive_runs.c.source_id == source_id,
            archive_run_items.c.status == "processing",
        ),
        "active_bulk_items": _count(
            cur,
            source_bulk_task_items.join(
                source_bulk_tasks, source_bulk_task_items.c.task_id == source_bulk_tasks.c.id
            ),
            source_bulk_task_items.c.source_id == source_id,
            source_bulk_task_items.c.status.not_in(["succeeded", "skipped", "failed", "cancelled"]),
            source_bulk_tasks.c.status.in_(["queued", "running", "pausing", "paused", "blocked"]),
        ),
        "enabled_schedules": _count(
            cur,
            source_schedule_policy_sources.join(
                source_schedule_policies,
                source_schedule_policy_sources.c.policy_id == source_schedule_policies.c.id,
            ),
            source_schedule_policy_sources.c.source_id == source_id,
            source_schedule_policies.c.enabled.is_(True),
        ),
    }
    cur.execute(
        *compile_query(
            select(archive_sources.c.id, archive_sources.c.source_url).where(
                archive_sources.c.source_type != LEGACY_MEDIA_SOURCE_TYPE,
                archive_sources.c.source_url.in_([target["source_url"] for target in targets]),
            )
        )
    )
    conflicts = [dict(row) for row in cur.fetchall()]
    return {
        "old_source_id": source_id,
        "source_url": source.source_url,
        "status": "blocked" if any(blockers.values()) or conflicts else "ready",
        "targets": targets,
        "blockers": blockers,
        "conflicts": conflicts,
        "batch_conflicts": [],
        "history": {
            "discoveries": _count(
                cur, source_discovered_tweets, source_discovered_tweets.c.source_id == source_id
            ),
            "scan_runs": _count(cur, source_scan_runs, source_scan_runs.c.source_id == source_id),
            "download_runs": _count(cur, archive_runs, archive_runs.c.source_id == source_id),
            "has_saved_cursor_state": bool(source.cursor_state),
        },
    }


def split_media_sources(
    source_ids: list[int] | None = None,
    *,
    all_sources: bool = False,
    apply: bool = False,
) -> dict[str, Any]:
    """逐来源事务拆分；可重复执行，冲突和活跃任务只报告、不覆盖。"""
    if bool(source_ids) == all_sources or any(source_id <= 0 for source_id in (source_ids or [])):
        raise ValueError("specify_source_ids_or_all")
    if all_sources:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    *compile_query(
                        select(archive_sources.c.id)
                        .where(
                            archive_sources.c.source_type == LEGACY_MEDIA_SOURCE_TYPE,
                            or_(
                                archive_sources.c.deleted_at.is_(None),
                                select(source_media_splits.c.old_source_id)
                                .where(
                                    source_media_splits.c.old_source_id == archive_sources.c.id,
                                )
                                .exists(),
                            ),
                        )
                        .order_by(archive_sources.c.id)
                    )
                )
                source_ids = [int(row["id"]) for row in cur.fetchall()]
    # Inspect the entire selection before any write, so aliases cannot win by
    # input order and make a previously "ready" peer fail partway through apply.
    results = [
        _try_split_one(source_id, apply=False) for source_id in dict.fromkeys(source_ids or [])
    ]
    target_owners: dict[str, set[int]] = {}
    for result in results:
        for target in result.get("targets", []):
            target_owners.setdefault(target["source_url"], set()).add(result["old_source_id"])
    for result in results:
        conflicts = [
            {
                "source_url": target["source_url"],
                "old_source_ids": sorted(target_owners[target["source_url"]]),
            }
            for target in result.get("targets", [])
            if len(target_owners[target["source_url"]]) > 1
        ]
        if conflicts:
            result.update(status="blocked", batch_conflicts=conflicts)
    if apply:
        for index, result in enumerate(results):
            if result["status"] != "ready":
                continue
            # Recheck database blockers/conflicts under the existing per-source
            # row lock; a preview does not reserve database state.
            result = _try_split_one(result["old_source_id"], apply=True)
            results[index] = result
            if result["status"] == "split":
                publish_event("sources", "source.media_split", result["mapping"])
    return {
        "dry_run": not apply,
        "sources": results,
        "blocked_count": sum(row["status"] == "blocked" for row in results),
    }


def _try_split_one(source_id: int, *, apply: bool) -> dict[str, Any]:
    try:
        return _split_one(source_id, apply=apply)
    except UniqueViolation:
        return {"old_source_id": source_id, "status": "blocked", "error": "source_url_conflict"}
    except ValueError as exc:
        return {"old_source_id": source_id, "status": "blocked", "error": str(exc)}


def _split_one(source_id: int, *, apply: bool) -> dict[str, Any]:
    with connect() as conn:
        with conn.cursor() as cur:
            statement = select(archive_sources).where(archive_sources.c.id == source_id)
            if apply:
                statement = statement.with_for_update()
            cur.execute(*compile_query(statement))
            row = cur.fetchone()
            if not row:
                raise ValueError("source_not_found")
            source = ArchiveSourceRow.model_validate(dict(row))
            result = _preview(cur, source)
            if not apply or result["status"] != "ready":
                return result
            ids = []
            for target, suffix in zip(result["targets"], ("图片", "视频"), strict=True):
                author = source.author_username or infer_author_username(
                    "user_media", source.source_url or ""
                )
                cur.execute(
                    *compile_query(
                        insert(archive_sources)
                        .values(
                            **target,
                            author_username=author,
                            label=f"{source.label or author or str(source.id)} · {suffix}",
                            status="paused",
                            cursor_state=Jsonb({}),
                            next_scan_at=None,
                        )
                        .returning(archive_sources.c.id)
                    )
                )
                ids.append(int(cur.fetchone()["id"]))
            cursor_state = set_active_scan_session_state(
                source.cursor_state, "stopped", enabled=False
            )
            cur.execute(
                *compile_query(
                    update(archive_sources)
                    .where(archive_sources.c.id == source_id)
                    .values(
                        status="paused",
                        is_pinned=False,
                        cursor_state=Jsonb(cursor_state),
                        next_scan_at=None,
                        deleted_at=func.coalesce(archive_sources.c.deleted_at, func.now()),
                        updated_at=func.now(),
                    )
                )
            )
            cur.execute(
                *compile_query(
                    insert(source_media_splits)
                    .values(
                        old_source_id=source_id,
                        photos_source_id=ids[0],
                        videos_source_id=ids[1],
                    )
                    .returning(source_media_splits)
                )
            )
            mapping = SourceMediaSplitRow.model_validate(dict(cur.fetchone()))
        conn.commit()
    return {**result, "status": "split", "mapping": mapping.model_dump(mode="json")}
