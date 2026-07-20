from __future__ import annotations

"""归档运行路由。

负责归档任务的提交、列表查询、详情查看，以及暂停、恢复、停止、重试、
条目级取消等控制动作。
"""

from fastapi import APIRouter, HTTPException, Query, status

from xarchiver.api.deps import raise_api_error
from xarchiver.api.schemas import (
    ArchiveRunCancelItemsRequest,
    ArchiveRunControlResponse,
    ArchiveRunDetailResponse,
    ArchiveRunsPageResponse,
    ArchiveSubmissionResponse,
    ArchiveSubmitRequest,
)
from xarchiver.services.queue import (
    cancel_run_items,
    get_run_detail,
    list_runs_page,
    pause_run,
    resume_run,
    retry_run,
    stop_run,
    submit_archive_batch,
)

router = APIRouter(prefix="/archive-runs", tags=["archive-runs"])


@router.post("", status_code=status.HTTP_202_ACCEPTED, response_model=ArchiveSubmissionResponse)
def submit_run(request: ArchiveSubmitRequest) -> dict[str, object]:
    """提交一批新的归档记录。"""

    try:
        return submit_archive_batch(
            [record.model_dump() for record in request.records],
            request.trigger_type,
        )
    except ValueError as exc:
        raise_api_error(exc)


@router.get("", response_model=ArchiveRunsPageResponse)
def archive_runs(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    run_status: str | None = None,
    tweet_id: str | None = None,
    failed_only: bool = False,
    source_id: int | None = None,
) -> dict[str, object]:
    """分页查询归档运行列表。"""

    kwargs = {"limit": limit, "offset": offset, "status": run_status, "tweet_id": tweet_id, "failed_only": failed_only}
    if source_id is not None:
        kwargs["source_id"] = source_id
    page = list_runs_page(**kwargs)
    return {**page, "rows": [dict(row) for row in page.get("rows", [])]}


@router.get("/{run_id}", response_model=ArchiveRunDetailResponse)
def archive_run_detail(run_id: int) -> dict[str, object]:
    """查询单个归档运行详情。"""

    result = get_run_detail(run_id)
    if result is None:
        raise HTTPException(status_code=404, detail="archive_run_not_found")
    return result


@router.post("/{run_id}/retry", status_code=status.HTTP_202_ACCEPTED, response_model=ArchiveSubmissionResponse)
def retry_archive_run(run_id: int) -> dict[str, object]:
    """基于失败条目触发一次归档运行重试。"""

    try:
        return retry_run(run_id)
    except ValueError as exc:
        raise_api_error(exc, default_status=409)


@router.post("/{run_id}/pause", response_model=ArchiveRunControlResponse)
def pause_archive_run(run_id: int) -> dict[str, object]:
    """暂停指定归档运行。"""

    try:
        return pause_run(run_id)
    except ValueError as exc:
        raise_api_error(exc, default_status=404)


@router.post("/{run_id}/resume", response_model=ArchiveRunControlResponse)
def resume_archive_run(run_id: int) -> dict[str, object]:
    """恢复指定归档运行。"""

    try:
        return resume_run(run_id)
    except ValueError as exc:
        raise_api_error(exc, default_status=404)


@router.post("/{run_id}/stop", response_model=ArchiveRunControlResponse)
def stop_archive_run(run_id: int) -> dict[str, object]:
    """停止指定归档运行。"""

    try:
        return stop_run(run_id)
    except ValueError as exc:
        raise_api_error(exc, default_status=404)


@router.post("/{run_id}/items/cancel", response_model=ArchiveRunControlResponse)
def cancel_archive_run_items(run_id: int, request: ArchiveRunCancelItemsRequest) -> dict[str, object]:
    """取消归档运行中的部分条目。"""

    try:
        return cancel_run_items(run_id, item_ids=request.item_ids, tweet_ids=request.tweet_ids)
    except ValueError as exc:
        raise_api_error(exc, default_status=409)
