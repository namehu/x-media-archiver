"""杂项只读路由与流式输出路由。

这里主要放事件流、下载策略、健康详情，以及本地媒体文件读取等不方便归类
到单一资源对象下的接口。
"""

from __future__ import annotations

import asyncio
import mimetypes
import time
from collections.abc import Iterator
from pathlib import Path
from queue import Empty
from typing import NamedTuple

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse

from xarchiver.api.deps import parse_event_topics, resolve_archive_file
from xarchiver.api.schemas import (
    DownloadPolicyResponse,
    HealthDetailResponse,
    RuntimeSnapshotResponse,
    RuntimeTransportDiagnosticsResponse,
)
from xarchiver.config import get_settings
from xarchiver.core.events import event_broker, format_sse_event, format_sse_heartbeat
from xarchiver.core.runtime_channel import get_runtime_transport_diagnostics
from xarchiver.services.auth import SESSION_COOKIE, authenticate_session
from xarchiver.services.health import get_health_detail
from xarchiver.services.runtime import get_runtime_snapshot

router = APIRouter(tags=["misc"])

MEDIA_CHUNK_SIZE = 64 * 1024
SSE_SESSION_RECHECK_SECONDS = 300.0


class ByteRange(NamedTuple):
    """HTTP Range 头解析后的字节区间。"""

    start: int
    end: int


def _iter_file_bytes(path: Path, start: int = 0, end: int | None = None) -> Iterator[bytes]:
    """按块迭代读取文件字节，支持部分区间读取。"""

    remaining = None if end is None else end - start + 1
    with path.open("rb") as file:
        file.seek(start)
        while remaining is None or remaining > 0:
            read_size = MEDIA_CHUNK_SIZE if remaining is None else min(MEDIA_CHUNK_SIZE, remaining)
            chunk = file.read(read_size)
            if not chunk:
                break
            yield chunk
            if remaining is not None:
                remaining -= len(chunk)


def _parse_range_header(range_header: str, total_size: int) -> ByteRange:
    """解析标准 `Range: bytes=...` 请求头。"""

    if not range_header.startswith("bytes="):
        raise ValueError("invalid_range")

    spec = range_header.removeprefix("bytes=").strip()
    if "," in spec or "-" not in spec:
        raise ValueError("invalid_range")

    start_text, end_text = spec.split("-", 1)
    if not start_text and not end_text:
        raise ValueError("invalid_range")

    try:
        if start_text:
            start = int(start_text)
            end = int(end_text) if end_text else total_size - 1
        else:
            suffix_length = int(end_text)
            if suffix_length <= 0:
                raise ValueError
            start = max(total_size - suffix_length, 0)
            end = total_size - 1
    except ValueError as exc:
        raise ValueError("invalid_range") from exc

    if start < 0 or end < start or start >= total_size:
        raise ValueError("invalid_range")

    return ByteRange(start=start, end=min(end, total_size - 1))


def _range_not_satisfiable_headers(total_size: int) -> dict[str, str]:
    """构造 416 Range Not Satisfiable 所需响应头。"""

    return {
        "Accept-Ranges": "bytes",
        "Content-Range": f"bytes */{total_size}",
        "Content-Length": "0",
    }


def _media_type_for(path: Path) -> str:
    """根据文件名推断响应的媒体类型。"""

    media_type, _ = mimetypes.guess_type(path.name)
    return media_type or "application/octet-stream"


@router.get("/events")
async def events(request: Request, topics: str | None = None) -> StreamingResponse:
    """建立 SSE 长连接，持续推送归档事件。"""

    subscription = event_broker.subscribe(parse_event_topics(topics))
    settings = get_settings()
    token = request.cookies.get(SESSION_COOKIE)

    async def event_stream():
        next_auth_check_at = time.monotonic() + SSE_SESSION_RECHECK_SECONDS
        try:
            yield ": connected\n\n"
            while not await request.is_disconnected():
                now = time.monotonic()
                if settings.auth_mode != "disabled" and now >= next_auth_check_at:
                    try:
                        current_user = await asyncio.to_thread(authenticate_session, token)
                    except Exception:
                        break
                    if current_user is None:
                        break
                    next_auth_check_at = now + SSE_SESSION_RECHECK_SECONDS
                try:
                    event = await asyncio.to_thread(subscription.get, 15.0)
                except Empty:
                    yield format_sse_heartbeat(*event_broker.watermark())
                    continue
                yield format_sse_event(event)
        finally:
            subscription.close()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/settings/download-policy", response_model=DownloadPolicyResponse)
def download_policy() -> dict[str, object]:
    """返回前端展示用的下载与扫描策略配置。"""

    settings = get_settings()
    return {
        "queue_batch_size": settings.queue_batch_size,
        "downloader_sleep_min_seconds": settings.downloader_sleep_min_seconds,
        "downloader_sleep_max_seconds": settings.downloader_sleep_max_seconds,
        "downloader_progress_fallback_interval_seconds": (
            settings.downloader_progress_fallback_interval_seconds
        ),
        "default_download_engine": settings.default_download_engine,
        "source_scan_batch_size": settings.source_scan_batch_size,
        "source_scan_sleep_min_seconds": settings.source_scan_sleep_min_seconds,
        "source_scan_sleep_max_seconds": settings.source_scan_sleep_max_seconds,
        "source_scan_http_timeout_seconds": settings.source_scan_http_timeout_seconds,
        "source_scan_http_retries": settings.source_scan_http_retries,
    }


@router.get("/health/detail", response_model=HealthDetailResponse)
def health_detail() -> dict[str, object]:
    """返回比 `/health` 更详细的诊断信息。"""

    return get_health_detail()


@router.get("/runtime/snapshot", response_model=RuntimeSnapshotResponse)
def runtime_snapshot() -> dict[str, object]:
    """返回 WebUI 运行态快照，用于首连、重连和轮询降级收敛。"""

    return get_runtime_snapshot()


@router.get("/runtime/diagnostics", response_model=RuntimeTransportDiagnosticsResponse)
def runtime_diagnostics() -> dict[str, object]:
    """返回有界的 runtime 传输计数，不包含事件正文。"""

    return get_runtime_transport_diagnostics()


@router.get("/media-file/{relative_path:path}")
def media_file(relative_path: str, range_header: str | None = Header(default=None, alias="Range")) -> StreamingResponse:
    """读取 archive 内的媒体文件，并支持 HTTP Range 分段响应。"""

    settings = get_settings()
    target = resolve_archive_file(settings.archive_dir, relative_path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="media_file_not_found")

    total_size = target.stat().st_size
    media_type = _media_type_for(target)
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(total_size),
    }
    if target.name.endswith(".preview.jpg"):
        headers["Cache-Control"] = "private, max-age=31536000, immutable"

    if range_header is None:
        return StreamingResponse(_iter_file_bytes(target), media_type=media_type, headers=headers)

    try:
        byte_range = _parse_range_header(range_header, total_size)
    except ValueError:
        return StreamingResponse(
            iter(()),
            status_code=416,
            media_type=media_type,
            headers=_range_not_satisfiable_headers(total_size),
        )
    content_length = byte_range.end - byte_range.start + 1
    headers.update(
        {
            "Content-Range": f"bytes {byte_range.start}-{byte_range.end}/{total_size}",
            "Content-Length": str(content_length),
        }
    )
    return StreamingResponse(
        _iter_file_bytes(target, byte_range.start, byte_range.end),
        status_code=206,
        media_type=media_type,
        headers=headers,
    )
