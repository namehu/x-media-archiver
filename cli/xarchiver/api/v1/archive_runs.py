from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status

from xarchiver.api.deps import execute_write_action, raise_api_error
from xarchiver.api.schemas import ArchiveRecord, ArchiveSubmitRequest
from xarchiver.services.queue import get_run_detail, list_runs_page, retry_run, submit_archive_batch

router = APIRouter(prefix="/archive-runs", tags=["archive-runs"])


@router.post("", status_code=status.HTTP_202_ACCEPTED)
def submit_run(request: ArchiveSubmitRequest) -> dict[str, object]:
    try:
        return submit_archive_batch(
            [record.model_dump() for record in request.records],
            request.trigger_type,
        )
    except ValueError as exc:
        raise_api_error(exc)


@router.get("")
def archive_runs(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    run_status: str | None = None,
    tweet_id: str | None = None,
    failed_only: bool = False,
) -> dict[str, object]:
    return list_runs_page(limit=limit, offset=offset, status=run_status, tweet_id=tweet_id, failed_only=failed_only)


@router.get("/{run_id}")
def archive_run_detail(run_id: int) -> dict[str, object]:
    result = get_run_detail(run_id)
    if result is None:
        raise HTTPException(status_code=404, detail="archive_run_not_found")
    return result


@router.post("/{run_id}/retry", status_code=status.HTTP_202_ACCEPTED)
def retry_archive_run(run_id: int) -> dict[str, object]:
    try:
        return retry_run(run_id)
    except ValueError as exc:
        raise_api_error(exc, default_status=409)
