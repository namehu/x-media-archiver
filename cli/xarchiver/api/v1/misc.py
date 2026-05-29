from __future__ import annotations

import asyncio
import mimetypes
from pathlib import Path
from typing import Iterator, NamedTuple

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from queue import Empty

from xarchiver.api.deps import parse_event_topics, resolve_archive_file
from xarchiver.api.schemas import DownloadPolicyResponse, HealthDetailResponse
from xarchiver.config import get_settings
from xarchiver.core.events import event_broker, format_sse_event
from xarchiver.services.health import get_health_detail

router = APIRouter(tags=["misc"])

MEDIA_CHUNK_SIZE = 64 * 1024


class ByteRange(NamedTuple):
    start: int
    end: int


def _iter_file_bytes(path: Path, start: int = 0, end: int | None = None) -> Iterator[bytes]:
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
    return {
        "Accept-Ranges": "bytes",
        "Content-Range": f"bytes */{total_size}",
        "Content-Length": "0",
    }


def _media_type_for(path: Path) -> str:
    media_type, _ = mimetypes.guess_type(path.name)
    return media_type or "application/octet-stream"


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
def media_file(relative_path: str, range_header: str | None = Header(default=None, alias="Range")) -> StreamingResponse:
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
