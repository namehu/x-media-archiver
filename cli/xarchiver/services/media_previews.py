"""媒体预览图持久任务、调度与独立 worker。"""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime, time, timedelta
from pathlib import Path
from threading import Event, Thread
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from psycopg.errors import UniqueViolation
from psycopg.types.json import Jsonb
from sqlalchemy import case, delete, func, insert, select, update

from xarchiver.config import Settings, get_settings
from xarchiver.core.events import publish_event
from xarchiver.db import connect
from xarchiver.media import (
    build_image_preview_temp,
    build_video_preview_temp,
    preview_is_current,
    preview_path_for_media,
)
from xarchiver.row_models import MediaPreviewJobRow, MediaPreviewScheduleRow
from xarchiver.services.source_bulk_tasks import calculate_next_policy_run, parse_local_time
from xarchiver.sql_builder import compile_query
from xarchiver.tables import media_assets, media_preview_jobs, media_preview_scheduler_settings

logger = logging.getLogger(__name__)

ACTIVE_JOB_STATUSES = ("queued", "running")
TERMINAL_JOB_STATUSES = ("completed", "completed_with_failures", "failed", "cancelled")
CANDIDATE_STATUSES = ("downloaded", "verified")
CANDIDATE_TYPES = ("photo", "video")
PREVIEW_BATCH_SIZE = 100
PREVIEW_LEASE_SECONDS = 60
PREVIEW_HEARTBEAT_SECONDS = 20
PREVIEW_MAX_RETRIES = 3
PREVIEW_RETRY_DELAYS_MINUTES = (1, 5, 15)
PREVIEW_FAILURE_SAMPLE_LIMIT = 100
PREVIEW_HISTORY_DAYS = 90
PREVIEW_HISTORY_MIN_COUNT = 100


def create_media_preview_job(*, mode: str, trigger_type: str = "manual") -> dict[str, Any]:
    """创建一个全局唯一的排队任务。"""

    if mode not in {"reconcile", "force"}:
        raise ValueError("invalid_media_preview_mode")
    if trigger_type not in {"manual", "scheduled", "retry"}:
        raise ValueError("invalid_media_preview_trigger")
    values = {
        "trigger_type": trigger_type,
        "mode": mode,
        "status": "queued",
        "options": Jsonb(_preview_options()),
        "next_attempt_at": datetime.now(UTC),
    }
    statement = insert(media_preview_jobs).values(**values).returning(*media_preview_jobs.c)
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                sql, params = compile_query(statement)
                cur.execute(sql, params)
                row = cur.fetchone()
            conn.commit()
    except UniqueViolation as exc:
        raise ValueError("media_preview_job_active") from exc
    assert row is not None
    job = _job_dict(row)
    _publish_job("media_preview_job.created", job)
    return job


def list_media_preview_jobs(*, limit: int = 50, offset: int = 0) -> dict[str, Any]:
    """分页返回预览任务历史。"""

    safe_limit = max(1, min(limit, 100))
    safe_offset = max(0, offset)
    rows_statement = (
        select(media_preview_jobs)
        .order_by(media_preview_jobs.c.created_at.desc(), media_preview_jobs.c.id.desc())
        .limit(safe_limit)
        .offset(safe_offset)
    )
    count_statement = select(func.count().label("total")).select_from(media_preview_jobs)
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(rows_statement)
            cur.execute(sql, params)
            rows = cur.fetchall()
            sql, params = compile_query(count_statement)
            cur.execute(sql, params)
            count_row = cur.fetchone()
            assert count_row is not None
            total = int(count_row["total"])
    return {
        "items": [_job_dict(row) for row in rows],
        "total": total,
        "limit": safe_limit,
        "offset": safe_offset,
    }


def get_media_preview_job(job_id: int) -> dict[str, Any] | None:
    statement = select(media_preview_jobs).where(media_preview_jobs.c.id == job_id)
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            row = cur.fetchone()
    return _job_dict(row) if row is not None else None


def cancel_media_preview_job(job_id: int) -> dict[str, Any] | None:
    """取消排队任务，或请求运行中任务在当前文件后停止。"""

    now = datetime.now(UTC)
    statement = (
        update(media_preview_jobs)
        .where(media_preview_jobs.c.id == job_id, media_preview_jobs.c.status.in_(ACTIVE_JOB_STATUSES))
        .values(
            cancel_requested=True,
            status=case((media_preview_jobs.c.status == "queued", "cancelled"), else_=media_preview_jobs.c.status),
            finished_at=case((media_preview_jobs.c.status == "queued", now), else_=media_preview_jobs.c.finished_at),
            updated_at=now,
        )
        .returning(*media_preview_jobs.c)
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            row = cur.fetchone()
        conn.commit()
    if row is None:
        return get_media_preview_job(job_id)
    job = _job_dict(row)
    _publish_job("media_preview_job.cancel_requested", job)
    return job


def get_media_preview_schedule() -> dict[str, Any]:
    row = _fetch_schedule_row()
    if row is None:
        raise ValueError("media_preview_schedule_missing")
    return _schedule_dict(row)


def update_media_preview_schedule(values: dict[str, object]) -> dict[str, Any]:
    """合并并验证单例调度配置；启用或变更后重算下一次运行时间。"""

    current = get_media_preview_schedule()
    merged = {**current, **{key: value for key, value in values.items() if value is not None}}
    normalized = _normalize_schedule(merged)
    now = datetime.now(UTC)
    next_run_at = calculate_next_policy_run(normalized, now) if normalized["enabled"] else None
    statement = (
        update(media_preview_scheduler_settings)
        .where(media_preview_scheduler_settings.c.id == 1)
        .values(**normalized, next_run_at=next_run_at, updated_at=now)
        .returning(*media_preview_scheduler_settings.c)
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            row = cur.fetchone()
        conn.commit()
    assert row is not None
    schedule = _schedule_dict(row)
    publish_event(
        "media_previews",
        "media_preview_schedule.updated",
        {"preview_schedule": schedule},
    )
    return schedule


def recover_expired_media_preview_jobs() -> int:
    """把进程中断后租约过期的任务放回队列，或在超限后标记失败。"""

    now = datetime.now(UTC)
    statement = select(media_preview_jobs).where(
        media_preview_jobs.c.status == "running",
        media_preview_jobs.c.lease_expires_at < now,
    )
    recovered = 0
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            rows = cur.fetchall()
            for row in rows:
                _retry_or_fail_locked(cur, _job_model(row), "media_preview_worker_interrupted", now)
                recovered += 1
        conn.commit()
    return recovered


def media_preview_worker_loop(
    worker_id: str,
    *,
    stop_event: Event,
    settings: Settings | None = None,
) -> None:
    """独立 CPU/IO worker：调度并串行执行预览任务。"""

    resolved_settings = settings or get_settings()
    while not stop_event.wait(2):
        try:
            process_due_media_preview_schedule()
            process_next_media_preview_job(worker_id, resolved_settings)
        except Exception:
            logger.exception("Media preview worker iteration failed")


def process_due_media_preview_schedule(now: datetime | None = None) -> dict[str, Any] | None:
    """到期且无活动任务时创建一次合并后的 reconcile 任务。"""

    now = now or datetime.now(UTC)
    with connect() as conn:
        with conn.cursor() as cur:
            schedule_statement = (
                select(media_preview_scheduler_settings)
                .where(media_preview_scheduler_settings.c.id == 1)
                .with_for_update()
            )
            sql, params = compile_query(schedule_statement)
            cur.execute(sql, params)
            row = cur.fetchone()
            if row is None or not row["enabled"] or row["next_run_at"] is None or row["next_run_at"] > now:
                return None
            active_statement = select(media_preview_jobs.c.id).where(
                media_preview_jobs.c.status.in_(ACTIVE_JOB_STATUSES)
            ).limit(1)
            sql, params = compile_query(active_statement)
            cur.execute(sql, params)
            if cur.fetchone() is not None:
                # 保持到期锚点不变；活动任务结束后的下一轮会合并补跑一次。
                return None
            schedule = _schedule_dict(row)
            create_statement = (
                insert(media_preview_jobs)
                .values(
                    trigger_type="scheduled",
                    mode="reconcile",
                    status="queued",
                    schedule_id=1,
                    options=Jsonb(_preview_options()),
                    next_attempt_at=now,
                )
                .returning(*media_preview_jobs.c)
            )
            sql, params = compile_query(create_statement)
            cur.execute(sql, params)
            job_row = cur.fetchone()
            assert job_row is not None
            next_run_at = calculate_next_policy_run(schedule, now)
            advance_statement = (
                update(media_preview_scheduler_settings)
                .where(media_preview_scheduler_settings.c.id == 1)
                .values(last_run_at=now, next_run_at=next_run_at, updated_at=now)
            )
            sql, params = compile_query(advance_statement)
            cur.execute(sql, params)
        conn.commit()
    job = _job_dict(job_row)
    _publish_job("media_preview_job.created", job)
    return job


def process_next_media_preview_job(worker_id: str, settings: Settings) -> dict[str, Any] | None:
    """认领并执行一个到期任务。"""

    job = _claim_next_job(worker_id)
    if job is None:
        return None
    try:
        return _run_job(job, worker_id, settings.archive_dir)
    except Exception as exc:
        logger.exception("Media preview job %s failed", job.id)
        return _retry_or_fail(job.id, _sanitized_task_error(exc))


def _claim_next_job(worker_id: str) -> MediaPreviewJobRow | None:
    now = datetime.now(UTC)
    with connect() as conn:
        with conn.cursor() as cur:
            statement = (
                select(media_preview_jobs)
                .where(
                    media_preview_jobs.c.status == "queued",
                    media_preview_jobs.c.cancel_requested.is_(False),
                    (media_preview_jobs.c.next_attempt_at.is_(None) | (media_preview_jobs.c.next_attempt_at <= now)),
                )
                .order_by(media_preview_jobs.c.created_at.asc(), media_preview_jobs.c.id.asc())
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            row = cur.fetchone()
            if row is None:
                return None
            job = _job_model(row)
            if job.snapshot_max_media_id is None:
                snapshot_max_id, total_count = _candidate_snapshot(cur)
            else:
                snapshot_max_id, total_count = job.snapshot_max_media_id, job.total_count
            claim_statement = (
                update(media_preview_jobs)
                .where(media_preview_jobs.c.id == job.id)
                .values(
                    status="running",
                    trigger_type="retry" if job.retry_count else job.trigger_type,
                    worker_id=worker_id,
                    lease_expires_at=now + timedelta(seconds=PREVIEW_LEASE_SECONDS),
                    snapshot_max_media_id=snapshot_max_id,
                    total_count=total_count,
                    started_at=job.started_at or now,
                    next_attempt_at=None,
                    updated_at=now,
                )
                .returning(*media_preview_jobs.c)
            )
            sql, params = compile_query(claim_statement)
            cur.execute(sql, params)
            claimed = cur.fetchone()
        conn.commit()
    assert claimed is not None
    claimed_job = _job_model(claimed)
    _publish_job("media_preview_job.started", claimed_job.model_dump(mode="python"))
    return claimed_job


def _run_job(job: MediaPreviewJobRow, worker_id: str, archive_dir: Path) -> dict[str, Any]:
    heartbeat_stop = Event()
    heartbeat = Thread(
        target=_heartbeat_job_lease,
        args=(job.id, worker_id, heartbeat_stop),
        name=f"media-preview-heartbeat-{job.id}",
        daemon=True,
    )
    heartbeat.start()
    try:
        return _run_job_batches(job, worker_id, archive_dir)
    finally:
        heartbeat_stop.set()
        heartbeat.join(timeout=1)


def _run_job_batches(job: MediaPreviewJobRow, worker_id: str, archive_dir: Path) -> dict[str, Any]:
    failure_samples = list((job.result or {}).get("failure_samples") or [])
    cursor = job.cursor_after_media_id
    while job.snapshot_max_media_id is not None and cursor < job.snapshot_max_media_id:
        if _job_cancel_requested(job.id, worker_id):
            return _finish_job(job.id, "cancelled", failure_samples)
        rows = _fetch_candidates(cursor, job.snapshot_max_media_id)
        if not rows:
            break
        for row in rows:
            media_id = int(row["id"])
            if _job_cancel_requested(job.id, worker_id):
                return _finish_job(job.id, "cancelled", failure_samples)
            result = "failed"
            error_code: str | None = None
            try:
                result = _process_media_candidate(row, archive_dir, force=job.mode == "force")
            except Exception as exc:
                error_code = _sanitized_media_error(exc)
                logger.warning("Media preview generation failed for media id %s: %s", media_id, error_code)
            if error_code and len(failure_samples) < PREVIEW_FAILURE_SAMPLE_LIMIT:
                failure_samples.append({"media_id": media_id, "error": error_code})
            job = _record_progress(job.id, worker_id, media_id, result, failure_samples)
            cursor = media_id
        if len(rows) < PREVIEW_BATCH_SIZE:
            break
    status = "completed_with_failures" if job.failed_count else "completed"
    return _finish_job(job.id, status, failure_samples)


def _heartbeat_job_lease(job_id: int, worker_id: str, stop_event: Event) -> None:
    """生成单个大文件期间也按 20 秒节奏续租。"""

    while not stop_event.wait(PREVIEW_HEARTBEAT_SECONDS):
        now = datetime.now(UTC)
        statement = (
            update(media_preview_jobs)
            .where(
                media_preview_jobs.c.id == job_id,
                media_preview_jobs.c.status == "running",
                media_preview_jobs.c.worker_id == worker_id,
            )
            .values(
                lease_expires_at=now + timedelta(seconds=PREVIEW_LEASE_SECONDS),
                updated_at=now,
            )
        )
        try:
            with connect() as conn:
                with conn.cursor() as cur:
                    sql, params = compile_query(statement)
                    cur.execute(sql, params)
                    alive = cur.rowcount > 0
                conn.commit()
            if not alive:
                return
        except Exception:
            logger.warning("Unable to renew media preview job %s lease", job_id, exc_info=True)


def _process_media_candidate(row: dict[str, Any], archive_dir: Path, *, force: bool) -> str:
    media_id = int(row["id"])
    media_type = str(row["media_type"])
    source_path = _safe_media_path(archive_dir, row.get("local_path"))
    preview_path = preview_path_for_media(source_path, media_type)
    if not force and preview_is_current(source_path, preview_path, media_type):
        return "existing"
    source_signature = _file_signature(source_path)
    temp_path = (
        build_video_preview_temp(source_path, preview_path)
        if media_type == "video"
        else build_image_preview_temp(source_path, preview_path)
    )
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                lock_statement = (
                    select(
                        media_assets.c.local_path,
                        media_assets.c.media_type,
                        media_assets.c.download_status,
                    )
                    .where(media_assets.c.id == media_id)
                    .with_for_update()
                )
                sql, params = compile_query(lock_statement)
                cur.execute(sql, params)
                current = cur.fetchone()
                if current is None:
                    raise RuntimeError("media_deleted_during_preview")
                current_path = _safe_media_path(archive_dir, current["local_path"])
                if (
                    current_path != source_path
                    or current["media_type"] != media_type
                    or current["download_status"] not in CANDIDATE_STATUSES
                    or _file_signature(source_path) != source_signature
                ):
                    raise RuntimeError("media_changed_during_preview")
                os.replace(temp_path, preview_path)
            conn.commit()
    finally:
        temp_path.unlink(missing_ok=True)
    return "generated"


def _record_progress(
    job_id: int,
    worker_id: str,
    media_id: int,
    result: str,
    failure_samples: list[dict[str, object]],
) -> MediaPreviewJobRow:
    now = datetime.now(UTC)
    values: dict[str, object] = {
        "cursor_after_media_id": media_id,
        "scanned_count": media_preview_jobs.c.scanned_count + 1,
        "lease_expires_at": now + timedelta(seconds=PREVIEW_LEASE_SECONDS),
        "updated_at": now,
        "result": Jsonb({"failure_samples": failure_samples}),
    }
    counter = {
        "generated": media_preview_jobs.c.generated_count,
        "existing": media_preview_jobs.c.existing_count,
        "failed": media_preview_jobs.c.failed_count,
    }[result]
    values[f"{result}_count"] = counter + 1
    statement = (
        update(media_preview_jobs)
        .where(
            media_preview_jobs.c.id == job_id,
            media_preview_jobs.c.status == "running",
            media_preview_jobs.c.worker_id == worker_id,
        )
        .values(**values)
        .returning(*media_preview_jobs.c)
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            row = cur.fetchone()
        conn.commit()
    if row is None:
        raise RuntimeError("media_preview_job_lease_lost")
    job = _job_model(row)
    _publish_job("media_preview_job.progress", job.model_dump(mode="python"))
    return job


def _finish_job(job_id: int, status: str, failure_samples: list[dict[str, object]]) -> dict[str, Any]:
    now = datetime.now(UTC)
    statement = (
        update(media_preview_jobs)
        .where(media_preview_jobs.c.id == job_id, media_preview_jobs.c.status == "running")
        .values(
            status=status,
            worker_id=None,
            lease_expires_at=None,
            next_attempt_at=None,
            finished_at=now,
            updated_at=now,
            result=Jsonb({"failure_samples": failure_samples}),
        )
        .returning(*media_preview_jobs.c)
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            row = cur.fetchone()
        conn.commit()
    if row is None:
        raise RuntimeError("media_preview_job_finish_failed")
    job = _job_dict(row)
    _publish_job("media_preview_job.finished", job)
    cleanup_media_preview_history(now)
    return job


def _retry_or_fail(job_id: int, error_message: str) -> dict[str, Any]:
    now = datetime.now(UTC)
    with connect() as conn:
        with conn.cursor() as cur:
            statement = select(media_preview_jobs).where(media_preview_jobs.c.id == job_id).with_for_update()
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            row = cur.fetchone()
            if row is None:
                raise RuntimeError("media_preview_job_missing")
            _retry_or_fail_locked(cur, _job_model(row), error_message, now)
        conn.commit()
    job = get_media_preview_job(job_id)
    assert job is not None
    _publish_job("media_preview_job.retry_scheduled" if job["status"] == "queued" else "media_preview_job.finished", job)
    return job


def _retry_or_fail_locked(cur: object, job: MediaPreviewJobRow, error_message: str, now: datetime) -> None:
    retry_count = job.retry_count + 1
    if retry_count <= PREVIEW_MAX_RETRIES:
        status = "queued"
        delay = PREVIEW_RETRY_DELAYS_MINUTES[retry_count - 1]
        values = {
            "status": status,
            "trigger_type": "retry",
            "retry_count": retry_count,
            "next_attempt_at": now + timedelta(minutes=delay),
            "worker_id": None,
            "lease_expires_at": None,
            "error_message": error_message,
            "updated_at": now,
        }
    else:
        values = {
            "status": "failed",
            "retry_count": retry_count,
            "worker_id": None,
            "lease_expires_at": None,
            "next_attempt_at": None,
            "error_message": error_message,
            "finished_at": now,
            "updated_at": now,
        }
    statement = update(media_preview_jobs).where(media_preview_jobs.c.id == job.id).values(**values)
    sql, params = compile_query(statement)
    cur.execute(sql, params)  # type: ignore[attr-defined]


def cleanup_media_preview_history(now: datetime | None = None) -> int:
    """删除 90 天前且不属于最新 100 条的任务记录，不触碰媒体文件。"""

    now = now or datetime.now(UTC)
    keep_ids = select(media_preview_jobs.c.id).order_by(media_preview_jobs.c.id.desc()).limit(PREVIEW_HISTORY_MIN_COUNT)
    statement = delete(media_preview_jobs).where(
        media_preview_jobs.c.status.in_(TERMINAL_JOB_STATUSES),
        media_preview_jobs.c.finished_at < now - timedelta(days=PREVIEW_HISTORY_DAYS),
        media_preview_jobs.c.id.not_in(keep_ids),
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            deleted = cur.rowcount
        conn.commit()
    return max(0, int(deleted or 0))


def _candidate_snapshot(cur: object) -> tuple[int | None, int]:
    conditions = (
        media_assets.c.local_path.is_not(None),
        media_assets.c.download_status.in_(CANDIDATE_STATUSES),
        media_assets.c.media_type.in_(CANDIDATE_TYPES),
    )
    statement = select(func.max(media_assets.c.id).label("max_id"), func.count().label("count")).where(*conditions)
    sql, params = compile_query(statement)
    cur.execute(sql, params)  # type: ignore[attr-defined]
    row = cur.fetchone()  # type: ignore[attr-defined]
    return (int(row["max_id"]) if row["max_id"] is not None else None, int(row["count"]))


def _fetch_candidates(after_id: int, snapshot_max_id: int) -> list[dict[str, Any]]:
    statement = (
        select(
            media_assets.c.id,
            media_assets.c.local_path,
            media_assets.c.media_type,
            media_assets.c.download_status,
        )
        .where(
            media_assets.c.id > after_id,
            media_assets.c.id <= snapshot_max_id,
            media_assets.c.local_path.is_not(None),
            media_assets.c.download_status.in_(CANDIDATE_STATUSES),
            media_assets.c.media_type.in_(CANDIDATE_TYPES),
        )
        .order_by(media_assets.c.id.asc())
        .limit(PREVIEW_BATCH_SIZE)
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            return [dict(row) for row in cur.fetchall()]


def _job_cancel_requested(job_id: int, worker_id: str) -> bool:
    statement = select(media_preview_jobs.c.cancel_requested).where(
        media_preview_jobs.c.id == job_id,
        media_preview_jobs.c.status == "running",
        media_preview_jobs.c.worker_id == worker_id,
    )
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            row = cur.fetchone()
    return row is None or bool(row["cancel_requested"])


def _fetch_schedule_row() -> dict[str, Any] | None:
    statement = select(media_preview_scheduler_settings).where(media_preview_scheduler_settings.c.id == 1)
    with connect() as conn:
        with conn.cursor() as cur:
            sql, params = compile_query(statement)
            cur.execute(sql, params)
            row = cur.fetchone()
    return dict(row) if row is not None else None


def _normalize_schedule(values: dict[str, object]) -> dict[str, object]:
    frequency_kind = str(values.get("frequency_kind") or "daily")
    if frequency_kind not in {"interval", "daily", "weekly"}:
        raise ValueError("invalid_media_preview_schedule_frequency")
    interval_minutes = int(values.get("interval_minutes") or 1440)
    if interval_minutes < 60:
        raise ValueError("invalid_media_preview_schedule_interval")
    local_time = parse_local_time(values.get("local_time")) or time(hour=3, minute=30)
    weekday = int(values.get("weekday") or 0)
    if not 0 <= weekday <= 6:
        raise ValueError("invalid_media_preview_schedule_weekday")
    timezone_name = str(values.get("timezone") or "Asia/Shanghai")
    try:
        ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError("invalid_media_preview_schedule_timezone") from exc
    jitter_seconds = int(values.get("jitter_seconds") or 0)
    if jitter_seconds < 0 or jitter_seconds > 86400:
        raise ValueError("invalid_media_preview_schedule_jitter")
    return {
        "enabled": bool(values.get("enabled")),
        "frequency_kind": frequency_kind,
        "interval_minutes": interval_minutes,
        "local_time": local_time,
        "weekday": weekday,
        "timezone": timezone_name,
        "jitter_seconds": jitter_seconds,
    }


def _safe_media_path(archive_dir: Path, value: object) -> Path:
    if not value:
        raise RuntimeError("media_path_missing")
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
        raise RuntimeError("invalid_media_preview_path")
    resolved = candidate.resolve()
    if media_root != resolved and media_root not in resolved.parents:
        raise RuntimeError("invalid_media_preview_path")
    if not resolved.is_file():
        raise RuntimeError("media_file_missing")
    return resolved


def _file_signature(path: Path) -> tuple[int, int]:
    stat = path.stat()
    return stat.st_size, stat.st_mtime_ns


def _preview_options() -> dict[str, object]:
    return {
        "image": {"format": "webp", "max_edge": 640, "quality": 82},
        "video": {"format": "jpeg", "max_width": 640},
        "batch_size": PREVIEW_BATCH_SIZE,
    }


def _job_model(row: object) -> MediaPreviewJobRow:
    return MediaPreviewJobRow.model_validate(dict(row))


def _job_dict(row: object) -> dict[str, Any]:
    return _job_model(row).model_dump(mode="python")


def _schedule_dict(row: object) -> dict[str, Any]:
    return MediaPreviewScheduleRow.model_validate(dict(row)).model_dump(mode="python")


def _publish_job(event_type: str, job: dict[str, Any]) -> None:
    publish_event(
        "media_previews",
        event_type,
        {"preview_job_id": job["id"], "preview_job": job},
    )


def _sanitized_media_error(exc: Exception) -> str:
    message = str(exc)
    known = {
        "empty_image_preview",
        "video_preview_generation_failed",
        "video_preview_decode_failed",
        "media_deleted_during_preview",
        "media_changed_during_preview",
        "media_path_missing",
        "invalid_media_preview_path",
        "media_file_missing",
    }
    if message in known:
        return message
    if isinstance(exc, OSError):
        return "media_preview_io_error"
    return "media_preview_decode_error"


def _sanitized_task_error(exc: Exception) -> str:
    message = str(exc)
    if message.startswith("media_preview_job_"):
        return message
    return "media_preview_worker_error"
