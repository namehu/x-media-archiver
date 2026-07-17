from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from psycopg.types.json import Jsonb
from sqlalchemy import delete, func, insert, select, update

from xarchiver.config import Settings
from xarchiver.core.errors import ArchiverError
from xarchiver.core.events import publish_event
from xarchiver.db import connect
from xarchiver.sql_builder import compile_query
from xarchiver.tables import archive_run_items, media_assets, media_delete_operations, tweets

ACTIVE_ITEM_STATUSES = ("pending", "blocked", "processing", "failed_retryable")


@dataclass(frozen=True)
class DeleteFile:
    path: Path
    required: bool


class MediaFileDeleteError(OSError):
    def __init__(self, cause: OSError, partial_result: dict[str, int]) -> None:
        super().__init__(str(cause))
        self.partial_result = partial_result


def delete_media_assets(
    settings: Settings,
    operation_id: UUID,
    media_ids: list[int],
) -> dict[str, object]:
    normalized_ids = list(dict.fromkeys(int(media_id) for media_id in media_ids))
    if not normalized_ids or len(normalized_ids) > 200:
        raise ArchiverError("invalid_media_ids")

    completed_result = _completed_result(operation_id)
    if completed_result is not None:
        return completed_result

    result: dict[str, object] | None = None
    failure: ArchiverError | None = None
    with connect() as conn:
        with conn.cursor() as cur:
            audit_sql, audit_params = compile_query(
                select(
                    media_delete_operations.c.status,
                    media_delete_operations.c.result,
                )
                .where(media_delete_operations.c.operation_id == operation_id)
                .with_for_update()
            )
            cur.execute(audit_sql, audit_params)
            audit = cur.fetchone()
            if audit and audit["status"] == "completed":
                return dict(audit["result"] or {})
            if audit and audit["status"] == "running":
                raise ArchiverError("media_delete_operation_in_progress", http_status=409)
            prior_partial = _prior_partial_result(audit)

            asset_sql, asset_params = compile_query(
                select(
                    media_assets.c.id,
                    media_assets.c.tweet_id,
                    media_assets.c.local_path,
                    media_assets.c.metadata_path,
                )
                .where(media_assets.c.id.in_(normalized_ids))
                .order_by(media_assets.c.id)
                .with_for_update()
            )
            cur.execute(asset_sql, asset_params)
            assets = [dict(row) for row in cur.fetchall()]
            found_ids = {int(row["id"]) for row in assets}
            if found_ids != set(normalized_ids):
                raise ArchiverError("media_assets_not_found", http_status=404)

            tweet_ids = list(dict.fromkeys(str(row["tweet_id"]) for row in assets))
            for tweet_id in tweet_ids:
                # Advisory locks are the established cross-worker serialization mechanism.
                cur.execute("select pg_advisory_xact_lock(hashtextextended(%s, 0))", (tweet_id,))

            active_sql, active_params = compile_query(
                select(archive_run_items.c.id)
                .where(archive_run_items.c.tweet_id.in_(tweet_ids))
                .where(archive_run_items.c.status.in_(ACTIVE_ITEM_STATUSES))
                .limit(1)
            )
            cur.execute(active_sql, active_params)
            if cur.fetchone():
                raise ArchiverError("media_delete_active_work", http_status=409)

            files = _collect_delete_files(settings.archive_dir, assets)
            _upsert_running_audit(cur, operation_id, normalized_ids, tweet_ids, bool(audit))

            try:
                file_result = _delete_files(files)
                _remove_empty_media_dirs(settings.archive_dir, files)
            except MediaFileDeleteError as exc:
                partial_result = {
                    "operation_id": str(operation_id),
                    "requested_media_count": len(normalized_ids),
                    "partial_deleted_file_count": (
                        prior_partial["deleted_file_count"]
                        + exc.partial_result["deleted_file_count"]
                    ),
                    "partial_deleted_bytes": (
                        prior_partial["deleted_bytes"]
                        + exc.partial_result["deleted_bytes"]
                    ),
                    "missing_file_count": exc.partial_result["missing_file_count"],
                    "tweet_ids": tweet_ids,
                }
                failure = ArchiverError(
                    "media_file_delete_failed",
                    message=str(exc),
                    http_status=500,
                )
                failed_sql, failed_params = compile_query(
                    update(media_delete_operations)
                    .where(media_delete_operations.c.operation_id == operation_id)
                    .values(
                        status="failed",
                        result=Jsonb(partial_result),
                        error_message=str(exc),
                        completed_at=None,
                    )
                )
                cur.execute(failed_sql, failed_params)
                conn.commit()
            else:
                delete_sql, delete_params = compile_query(
                    delete(media_assets).where(media_assets.c.id.in_(normalized_ids))
                )
                cur.execute(delete_sql, delete_params)
                tweet_sql, tweet_params = compile_query(
                    update(tweets)
                    .where(tweets.c.tweet_id.in_(tweet_ids))
                    .values(
                        download_status="missing",
                        last_error="media_deleted_by_user",
                        updated_at=func.now(),
                    )
                )
                cur.execute(tweet_sql, tweet_params)
                result = {
                    "operation_id": str(operation_id),
                    "deleted_media_count": len(normalized_ids),
                    "deleted_file_count": (
                        prior_partial["deleted_file_count"]
                        + file_result["deleted_file_count"]
                    ),
                    "deleted_bytes": prior_partial["deleted_bytes"] + file_result["deleted_bytes"],
                    "missing_file_count": file_result["missing_file_count"],
                    "tweet_ids": tweet_ids,
                }
                completed_sql, completed_params = compile_query(
                    update(media_delete_operations)
                    .where(media_delete_operations.c.operation_id == operation_id)
                    .values(
                        status="completed",
                        result=Jsonb(result),
                        error_message=None,
                        completed_at=func.now(),
                    )
                )
                cur.execute(completed_sql, completed_params)
                conn.commit()

    if failure is not None:
        raise failure
    assert result is not None
    publish_event(
        "library",
        "library.media_deleted",
        {"operation_id": str(operation_id), "tweet_ids": result["tweet_ids"]},
    )
    return result


def _completed_result(operation_id: UUID) -> dict[str, object] | None:
    sql, params = compile_query(
        select(media_delete_operations.c.status, media_delete_operations.c.result).where(
            media_delete_operations.c.operation_id == operation_id
        )
    )
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
    if row and row["status"] == "completed":
        return dict(row["result"] or {})
    return None


def _prior_partial_result(audit: Mapping[str, object] | None) -> dict[str, int]:
    if not audit or audit["status"] != "failed":
        return {"deleted_file_count": 0, "deleted_bytes": 0}
    value = audit.get("result")
    result = value if isinstance(value, dict) else {}
    return {
        "deleted_file_count": int(result.get("partial_deleted_file_count") or 0),
        "deleted_bytes": int(result.get("partial_deleted_bytes") or 0),
    }


def _upsert_running_audit(
    cur: object,
    operation_id: UUID,
    media_ids: list[int],
    tweet_ids: list[str],
    exists: bool,
) -> None:
    if exists:
        statement = (
            update(media_delete_operations)
            .where(media_delete_operations.c.operation_id == operation_id)
            .values(
                requested_media_ids=Jsonb(media_ids),
                tweet_ids=Jsonb(tweet_ids),
                status="running",
                result=None,
                error_message=None,
                completed_at=None,
            )
        )
    else:
        statement = insert(media_delete_operations).values(
            operation_id=operation_id,
            requested_media_ids=Jsonb(media_ids),
            tweet_ids=Jsonb(tweet_ids),
            status="running",
        )
    sql, params = compile_query(statement)
    cur.execute(sql, params)  # type: ignore[attr-defined]


def _collect_delete_files(archive_dir: Path, assets: list[dict[str, object]]) -> list[DeleteFile]:
    files: dict[str, DeleteFile] = {}
    for asset in assets:
        local_path = _safe_media_path(archive_dir, asset.get("local_path"))
        metadata_path = _safe_media_path(archive_dir, asset.get("metadata_path"))
        for path in (local_path, metadata_path):
            if path is not None:
                files[str(path)] = DeleteFile(path, required=True)
        if local_path is not None:
            thumbnail = local_path.with_name(f"{local_path.stem}.thumb.jpg")
            safe_thumbnail = _safe_media_path(archive_dir, thumbnail)
            assert safe_thumbnail is not None
            if safe_thumbnail.exists():
                files[str(safe_thumbnail)] = DeleteFile(safe_thumbnail, required=False)
    return list(files.values())


def _safe_media_path(archive_dir: Path, value: object) -> Path | None:
    if not value:
        return None
    path_text = str(value).replace("\\", "/")
    archive_text = archive_dir.as_posix().rstrip("/")
    if path_text.startswith(f"{archive_text}/"):
        relative = path_text[len(archive_text) + 1 :]
    elif "/archive/" in path_text:
        relative = path_text.split("/archive/", 1)[1]
    else:
        relative = path_text
    media_root = (archive_dir / "media").resolve()
    candidate = archive_dir / Path(relative)
    if candidate.is_symlink():
        raise ArchiverError("invalid_media_delete_path")
    resolved = candidate.resolve()
    if media_root != resolved and media_root not in resolved.parents:
        raise ArchiverError("invalid_media_delete_path")
    if resolved.exists() and not resolved.is_file():
        raise ArchiverError("invalid_media_delete_path")
    return resolved


def _delete_files(files: list[DeleteFile]) -> dict[str, int]:
    deleted_file_count = 0
    deleted_bytes = 0
    missing_file_count = 0
    for item in files:
        try:
            if not item.path.exists():
                if item.required:
                    missing_file_count += 1
                continue
            file_size = item.path.stat().st_size
            item.path.unlink()
        except OSError as exc:
            raise MediaFileDeleteError(
                exc,
                {
                    "deleted_file_count": deleted_file_count,
                    "deleted_bytes": deleted_bytes,
                    "missing_file_count": missing_file_count,
                },
            ) from exc
        deleted_file_count += 1
        deleted_bytes += file_size
    return {
        "deleted_file_count": deleted_file_count,
        "deleted_bytes": deleted_bytes,
        "missing_file_count": missing_file_count,
    }


def _remove_empty_media_dirs(archive_dir: Path, files: list[DeleteFile]) -> None:
    media_root = (archive_dir / "media").resolve()
    parents = sorted(
        {item.path.parent for item in files},
        key=lambda path: len(path.parts),
        reverse=True,
    )
    for parent in parents:
        current = parent
        while current != media_root and media_root in current.parents:
            try:
                current.rmdir()
            except OSError:
                break
            current = current.parent
