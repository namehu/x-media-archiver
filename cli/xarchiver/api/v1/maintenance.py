"""显式维护动作路由。

这些动作通常会触发较重的扫描或校验，因此会额外要求调用方进行显式确认。
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status

from xarchiver.api.deps import execute_write_action, raise_api_error, require_full_scan_confirmation
from xarchiver.api.schemas import (
    BackfillRequest,
    MediaPreviewJobCreateRequest,
    MediaPreviewJobResponse,
    MediaPreviewJobsPageResponse,
    MediaPreviewScheduleResponse,
    MediaPreviewScheduleUpdateRequest,
    VerifyRequest,
    WriteActionResponse,
)
from xarchiver.config import get_settings
from xarchiver.services.media_previews import (
    cancel_media_preview_job,
    create_media_preview_job,
    get_media_preview_job,
    get_media_preview_schedule,
    list_media_preview_jobs,
    update_media_preview_schedule,
)
from xarchiver.services.runs import run_backfill, run_verify

router = APIRouter(prefix="/maintenance", tags=["maintenance"])


@router.post("/backfill", response_model=WriteActionResponse)
def maintenance_backfill(request: BackfillRequest) -> dict[str, object]:
    """触发基于归档目录文件的媒体回填。"""

    require_full_scan_confirmation(request.confirm_full_scan)
    settings = get_settings()
    return execute_write_action(
        "maintenance-backfill",
        lambda: run_backfill(settings, request.normalize_files),
    )


@router.post("/verify", response_model=WriteActionResponse)
def maintenance_verify(request: VerifyRequest) -> dict[str, object]:
    """触发媒体校验维护动作。"""

    require_full_scan_confirmation(request.confirm_full_scan)
    return execute_write_action("maintenance-verify", lambda: run_verify(request.limit))


@router.post(
    "/preview-jobs",
    response_model=MediaPreviewJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_preview_job(request: MediaPreviewJobCreateRequest) -> dict[str, object]:
    """创建与下载解耦的全库索引预览任务。"""

    require_full_scan_confirmation(request.confirm_full_scan)
    if request.mode == "force" and not request.confirm_force:
        raise HTTPException(status_code=400, detail="preview_force_confirmation_required")
    try:
        return create_media_preview_job(mode=request.mode)
    except ValueError as exc:
        raise_api_error(exc, default_status=409)
        raise


@router.get("/preview-jobs", response_model=MediaPreviewJobsPageResponse)
def list_preview_jobs(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, object]:
    return list_media_preview_jobs(limit=limit, offset=offset)


@router.get("/preview-jobs/{job_id}", response_model=MediaPreviewJobResponse)
def get_preview_job(job_id: int) -> dict[str, object]:
    job = get_media_preview_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="media_preview_job_not_found")
    return job


@router.post("/preview-jobs/{job_id}/cancel", response_model=MediaPreviewJobResponse)
def cancel_preview_job(job_id: int) -> dict[str, object]:
    job = cancel_media_preview_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="media_preview_job_not_found")
    return job


@router.get("/preview-schedule", response_model=MediaPreviewScheduleResponse)
def get_preview_schedule() -> dict[str, object]:
    try:
        return get_media_preview_schedule()
    except ValueError as exc:
        raise_api_error(exc, default_status=404)
        raise


@router.patch("/preview-schedule", response_model=MediaPreviewScheduleResponse)
def patch_preview_schedule(request: MediaPreviewScheduleUpdateRequest) -> dict[str, object]:
    try:
        return update_media_preview_schedule(request.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise_api_error(exc)
        raise
