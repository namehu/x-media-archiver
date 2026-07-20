from __future__ import annotations

"""API 路由共用依赖与辅助函数。

主要负责写操作串行化、统一错误转换、事件主题解析，以及媒体文件路径的
安全解析。
"""

from collections.abc import Callable
from pathlib import Path
from threading import Event, Lock

from fastapi import HTTPException, status

from xarchiver.core.errors import ArchiverError, http_status_for_error_code
from xarchiver.core.lock_manager import lock_manager

write_action_lock = Lock()
stop_worker = Event()


def execute_write_action(
    name: str,
    action: Callable[[], dict[str, object]],
    *,
    scope: str = "global",
) -> dict[str, object]:
    """以互斥方式执行写操作，并统一返回写操作结果结构。"""

    if write_action_lock.locked() or (scope != "global" and lock_manager.locked("global")):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="write_action_in_progress",
        )
    if scope == "global" and lock_manager.any_locked(exclude={"global"}):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="write_action_in_progress",
        )
    with lock_manager.acquire(scope, blocking=False) as acquired:
        if not acquired:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="write_action_in_progress",
            )
        result = action()
        return {"action": name, "status": "completed", "result": result}


def write_lock_held(scope: str = "global") -> bool:
    """返回指定作用域当前是否持有写锁。"""

    return lock_manager.locked(scope)


def require_full_scan_confirmation(confirmed: bool) -> None:
    """要求调用方显式确认会触发全量扫描的危险操作。"""

    if not confirmed:
        raise HTTPException(status_code=400, detail="full_scan_confirmation_required")


def raise_api_error(error: ArchiverError | ValueError, *, default_status: int = 400) -> None:
    """把 service 层异常转换成 API 层 HTTP 错误。"""

    if isinstance(error, ArchiverError):
        raise HTTPException(status_code=error.http_status, detail=error.code) from error
    detail = str(error)
    raise HTTPException(
        status_code=http_status_for_error_code(detail, default=default_status),
        detail=detail,
    ) from error


def parse_event_topics(topics: str | None) -> list[str] | None:
    """把逗号分隔的 SSE topic 查询参数解析成列表。"""

    if not topics:
        return None
    return [topic.strip() for topic in topics.split(",") if topic.strip()]


def resolve_archive_file(archive_dir: Path, relative_path: str) -> Path:
    """把 archive 相对路径解析成真实文件路径，并阻止目录逃逸。"""

    base = archive_dir.resolve()
    target = (base / relative_path).resolve()
    if base != target and base not in target.parents:
        raise HTTPException(status_code=400, detail="invalid_media_path")
    return target
