from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status

from xarchiver.api.deps import execute_write_action, raise_api_error
from xarchiver.api.schemas import (
    ArchiveSourceDetailResponse,
    ArchiveSourceResponse,
    ArchiveSubmissionResponse,
    SourcesPageResponse,
    SourceCreateRequest,
    SourceHistoryScanRequest,
    SourceRecordsRequest,
    SourceScanRequest,
    SourceStatusRequest,
    SourceSubmitDiscoveredRequest,
    WriteActionResponse,
)
from xarchiver.services.sources import (
    create_source,
    get_source,
    list_sources_page,
    scan_source,
    start_source_history_scan,
    stop_source_history_scan,
    submit_discovered_tweets,
    submit_source_records,
    update_source_status,
)

router = APIRouter(prefix="/sources", tags=["sources"])


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ArchiveSourceResponse)
def create_archive_source(request: SourceCreateRequest) -> dict[str, object]:
    try:
        return create_source(
            request.source_type,
            request.source_url,
            label=request.label,
            author_username=request.author_username,
        )
    except ValueError as exc:
        raise_api_error(exc)


@router.get("", response_model=SourcesPageResponse)
def archive_sources(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    source_status: str | None = None,
    source_type: str | None = None,
) -> dict[str, object]:
    try:
        return list_sources_page(status=source_status, source_type=source_type, limit=limit, offset=offset)
    except ValueError as exc:
        raise_api_error(exc)


@router.get("/{source_id}", response_model=ArchiveSourceDetailResponse)
def archive_source_detail(source_id: int) -> dict[str, object]:
    result = get_source(source_id)
    if result is None:
        raise HTTPException(status_code=404, detail="source_not_found")
    return result


@router.post("/{source_id}/records", status_code=status.HTTP_202_ACCEPTED, response_model=ArchiveSubmissionResponse)
def submit_archive_source_records(source_id: int, request: SourceRecordsRequest) -> dict[str, object]:
    try:
        return submit_source_records(source_id, [record.model_dump() for record in request.records])
    except ValueError as exc:
        raise_api_error(exc)


@router.post(
    "/{source_id}/submit-discovered",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=ArchiveSubmissionResponse,
)
def submit_archive_source_discovered(
    source_id: int,
    request: SourceSubmitDiscoveredRequest,
) -> dict[str, object]:
    try:
        return submit_discovered_tweets(source_id, limit=request.limit)
    except ValueError as exc:
        raise_api_error(exc, default_status=409)


@router.post("/{source_id}/status", response_model=ArchiveSourceResponse)
def update_archive_source_status(source_id: int, request: SourceStatusRequest) -> dict[str, object]:
    try:
        return update_source_status(source_id, request.status)
    except ValueError as exc:
        raise_api_error(exc)


@router.post("/{source_id}/scan", status_code=status.HTTP_202_ACCEPTED, response_model=WriteActionResponse)
def scan_archive_source(source_id: int, request: SourceScanRequest) -> dict[str, object]:
    try:
        return execute_write_action("source-scan", lambda: scan_source(source_id, request.limit, restart=request.restart))
    except ValueError as exc:
        raise_api_error(exc)


@router.post("/{source_id}/history-scan", status_code=status.HTTP_202_ACCEPTED, response_model=ArchiveSourceDetailResponse)
def start_archive_source_history_scan(source_id: int, request: SourceHistoryScanRequest) -> dict[str, object]:
    try:
        return start_source_history_scan(source_id, request.limit, request.restart)
    except ValueError as exc:
        raise_api_error(exc)


@router.post("/{source_id}/history-scan/stop", response_model=ArchiveSourceDetailResponse)
def stop_archive_source_history_scan(source_id: int) -> dict[str, object]:
    try:
        return stop_source_history_scan(source_id)
    except ValueError as exc:
        raise_api_error(exc, default_status=404)
