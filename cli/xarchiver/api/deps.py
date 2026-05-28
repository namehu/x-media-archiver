from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from threading import Event, Lock

from fastapi import HTTPException, status

from xarchiver.core.errors import ArchiverError, http_status_for_error_code

write_action_lock = Lock()
stop_worker = Event()


def execute_write_action(name: str, action: Callable[[], dict[str, object]]) -> dict[str, object]:
    if not write_action_lock.acquire(blocking=False):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="write_action_in_progress",
        )
    try:
        result = action()
        return {"action": name, "status": "completed", "result": result}
    finally:
        write_action_lock.release()


def require_full_scan_confirmation(confirmed: bool) -> None:
    if not confirmed:
        raise HTTPException(status_code=400, detail="full_scan_confirmation_required")


def raise_api_error(error: ArchiverError | ValueError, *, default_status: int = 400) -> None:
    if isinstance(error, ArchiverError):
        raise HTTPException(status_code=error.http_status, detail=error.code) from error
    detail = str(error)
    raise HTTPException(
        status_code=http_status_for_error_code(detail, default=default_status),
        detail=detail,
    ) from error


def parse_event_topics(topics: str | None) -> list[str] | None:
    if not topics:
        return None
    return [topic.strip() for topic in topics.split(",") if topic.strip()]


def resolve_archive_file(archive_dir: Path, relative_path: str) -> Path:
    base = archive_dir.resolve()
    target = (base / relative_path).resolve()
    if base != target and base not in target.parents:
        raise HTTPException(status_code=400, detail="invalid_media_path")
    return target
