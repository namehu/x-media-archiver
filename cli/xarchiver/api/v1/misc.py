from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from queue import Empty

from xarchiver.api.deps import parse_event_topics, resolve_archive_file
from xarchiver.api.schemas import DownloadPolicyResponse, HealthDetailResponse
from xarchiver.config import get_settings
from xarchiver.core.events import event_broker, format_sse_event
from xarchiver.services.health import get_health_detail

router = APIRouter(tags=["misc"])


@router.get("/events")
async def events(request: Request, topics: str | None = None) -> StreamingResponse:
    subscription = event_broker.subscribe(parse_event_topics(topics))

    async def event_stream():
        try:
            yield ": connected\n\n"
            while not await request.is_disconnected():
                try:
                    event = await asyncio.to_thread(subscription.get, 15.0)
                except Empty:
                    yield ": keepalive\n\n"
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
    settings = get_settings()
    return {
        "queue_batch_size": settings.queue_batch_size,
        "downloader_sleep_min_seconds": settings.downloader_sleep_min_seconds,
        "downloader_sleep_max_seconds": settings.downloader_sleep_max_seconds,
        "default_download_engine": settings.default_download_engine,
        "source_scan_batch_size": settings.source_scan_batch_size,
        "source_scan_sleep_min_seconds": settings.source_scan_sleep_min_seconds,
        "source_scan_sleep_max_seconds": settings.source_scan_sleep_max_seconds,
    }


@router.get("/health/detail", response_model=HealthDetailResponse)
def health_detail() -> dict[str, object]:
    return get_health_detail()


@router.get("/media-file/{relative_path:path}")
def media_file(relative_path: str) -> FileResponse:
    settings = get_settings()
    target = resolve_archive_file(settings.archive_dir, relative_path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="media_file_not_found")
    return FileResponse(target)
