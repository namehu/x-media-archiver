"""来源管理与来源扫描路由。

负责来源的创建、列表/详情查询、发现结果查看、下载提交，以及扫描会话的
启动、暂停、恢复和停止。
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status

from xarchiver.api.deps import execute_write_action, raise_api_error
from xarchiver.api.schemas import (
    ArchiveSourceDetailResponse,
    ArchiveSourceResponse,
    ArchiveSubmissionResponse,
    SourceCreateRequest,
    SourceDeleteRequest,
    SourceDeleteResponse,
    SourceDiscoveryPageResponse,
    SourceDownloadRequest,
    SourceDownloadSummaryResponse,
    SourceHistoryScanRequest,
    SourcePinRequest,
    SourceRecordsRequest,
    SourceScanRequest,
    SourceScanRunsPageResponse,
    SourceScanSessionRequest,
    SourcesPageResponse,
    SourceStatusRequest,
    SourceSubmitDiscoveredRequest,
    WriteActionResponse,
)
from xarchiver.services.sources import (
    create_source,
    delete_source,
    get_source,
    get_source_downloads,
    list_source_discovered_page,
    list_source_scan_runs_page,
    list_sources_page,
    pause_source_scan_session,
    resume_source_scan_session,
    scan_source,
    start_source_history_scan,
    start_source_scan_session,
    stop_source_history_scan,
    stop_source_scan_session,
    submit_discovered_tweets,
    submit_source_downloads,
    submit_source_records,
    update_source_pin,
    update_source_status,
)

router = APIRouter(prefix="/sources", tags=["sources"])


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ArchiveSourceResponse)
def create_archive_source(request: SourceCreateRequest) -> dict[str, object]:
    """创建一个新的归档来源。"""

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
    sort_by: str = Query("updated_at", pattern="^(updated_at|created_at)$"),
    sort_direction: str = Query("desc", pattern="^(asc|desc)$"),
) -> dict[str, object]:
    """分页查询来源列表。"""

    try:
        page = list_sources_page(
            status=source_status,
            source_type=source_type,
            sort_by=sort_by,
            sort_direction=sort_direction,
            limit=limit,
            offset=offset,
        )
        return {**page, "rows": [dict(row) for row in page.get("rows", [])]}
    except ValueError as exc:
        raise_api_error(exc)


@router.get("/{source_id}", response_model=ArchiveSourceDetailResponse)
def archive_source_detail(source_id: int) -> dict[str, object]:
    """查询单个来源的详情。"""

    result = get_source(source_id)
    if result is None:
        raise HTTPException(status_code=404, detail="source_not_found")
    return result


@router.delete("/{source_id}", response_model=SourceDeleteResponse)
def delete_archive_source(source_id: int, request: SourceDeleteRequest) -> dict[str, object]:
    """软删除来源配置，不删除 Tweet、媒体文件或任务历史。"""

    try:
        return execute_write_action(
            "source-delete",
            lambda: delete_source(source_id, request.confirm_delete),
            scope=f"source:{source_id}",
        )["result"]
    except ValueError as exc:
        raise_api_error(exc, default_status=409)


@router.get("/{source_id}/discovered", response_model=SourceDiscoveryPageResponse)
def archive_source_discovered(
    source_id: int,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, object]:
    try:
        return list_source_discovered_page(source_id, limit=limit, offset=offset)
    except ValueError as exc:
        raise_api_error(exc)


@router.get("/{source_id}/downloads", response_model=SourceDownloadSummaryResponse)
def archive_source_downloads(source_id: int) -> dict[str, object]:
    """查询某个来源当前下载状态摘要。"""

    try:
        return get_source_downloads(source_id)
    except ValueError as exc:
        raise_api_error(exc, default_status=404)


@router.post("/{source_id}/downloads", status_code=status.HTTP_202_ACCEPTED, response_model=ArchiveSubmissionResponse)
def submit_archive_source_downloads(source_id: int, request: SourceDownloadRequest) -> dict[str, object]:
    """把来源发现到的推文按指定范围提交到下载队列。"""

    try:
        return submit_source_downloads(
            source_id,
            request.scope,
            tweet_ids=request.tweet_ids,
            limit=request.limit,
        )
    except ValueError as exc:
        raise_api_error(exc, default_status=409)


@router.get("/{source_id}/scan-runs", response_model=SourceScanRunsPageResponse)
def archive_source_scan_runs(
    source_id: int,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict[str, object]:
    try:
        return list_source_scan_runs_page(source_id, limit=limit, offset=offset)
    except ValueError as exc:
        raise_api_error(exc)


@router.post("/{source_id}/records", status_code=status.HTTP_202_ACCEPTED, response_model=ArchiveSubmissionResponse)
def submit_archive_source_records(source_id: int, request: SourceRecordsRequest) -> dict[str, object]:
    """直接向某个来源补充记录并提交下载。"""

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
    """更新来源状态。"""

    try:
        return update_source_status(source_id, request.status)
    except ValueError as exc:
        raise_api_error(exc)


@router.post("/{source_id}/pin", response_model=ArchiveSourceDetailResponse)
def update_archive_source_pin(source_id: int, request: SourcePinRequest) -> dict[str, object]:
    """更新来源是否置顶。"""

    try:
        return update_source_pin(source_id, request.is_pinned)
    except ValueError as exc:
        raise_api_error(exc, default_status=404)


@router.post("/{source_id}/scan", status_code=status.HTTP_202_ACCEPTED, response_model=WriteActionResponse)
def scan_archive_source(source_id: int, request: SourceScanRequest) -> dict[str, object]:
    """立即触发某个来源的一次扫描。"""

    try:
        return execute_write_action(
            "source-scan",
            lambda: scan_source(source_id, request.limit, restart=request.restart),
            scope=f"source:{source_id}",
        )
    except ValueError as exc:
        raise_api_error(exc)


@router.post("/{source_id}/history-scan", status_code=status.HTTP_202_ACCEPTED, response_model=ArchiveSourceDetailResponse)
def start_archive_source_history_scan(source_id: int, request: SourceHistoryScanRequest) -> dict[str, object]:
    """兼容旧入口：启动一次 history 扫描。"""

    try:
        return start_source_history_scan(source_id, request.limit, request.restart)
    except ValueError as exc:
        raise_api_error(exc)


@router.post("/{source_id}/scan-sessions", status_code=status.HTTP_202_ACCEPTED, response_model=ArchiveSourceDetailResponse)
def start_archive_source_scan_session(source_id: int, request: SourceScanSessionRequest) -> dict[str, object]:
    """启动一个具名扫描会话。"""

    try:
        return start_source_scan_session(source_id, request.mode, request.limit, request.restart)
    except ValueError as exc:
        raise_api_error(exc)


@router.post("/{source_id}/scan-sessions/pause", response_model=ArchiveSourceDetailResponse)
def pause_archive_source_scan_session(source_id: int) -> dict[str, object]:
    """暂停来源当前扫描会话。"""

    try:
        return pause_source_scan_session(source_id)
    except ValueError as exc:
        raise_api_error(exc)


@router.post("/{source_id}/scan-sessions/resume", response_model=ArchiveSourceDetailResponse)
def resume_archive_source_scan_session(source_id: int) -> dict[str, object]:
    """恢复来源当前扫描会话。"""

    try:
        return resume_source_scan_session(source_id)
    except ValueError as exc:
        raise_api_error(exc)


@router.post("/{source_id}/scan-sessions/stop", response_model=ArchiveSourceDetailResponse)
def stop_archive_source_scan_session(source_id: int) -> dict[str, object]:
    """停止来源当前扫描会话。"""

    try:
        return stop_source_scan_session(source_id)
    except ValueError as exc:
        raise_api_error(exc, default_status=404)


@router.post("/{source_id}/history-scan/stop", response_model=ArchiveSourceDetailResponse)
def stop_archive_source_history_scan(source_id: int) -> dict[str, object]:
    """兼容旧入口：停止 history 扫描。"""

    try:
        return stop_source_history_scan(source_id)
    except ValueError as exc:
        raise_api_error(exc, default_status=404)
