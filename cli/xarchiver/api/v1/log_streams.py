from __future__ import annotations

"""操作日志流路由。

负责列出日志流元信息，以及按游标读取某条日志流中的增量日志。
"""

from fastapi import APIRouter, HTTPException, Query

from xarchiver.api.deps import raise_api_error
from xarchiver.api.schemas import OperationLogEntriesResponse, OperationLogStreamsPageResponse
from xarchiver.services.operation_logs import list_operation_log_streams, read_operation_log_entries

router = APIRouter(prefix="/log-streams", tags=["log-streams"])


@router.get("", response_model=OperationLogStreamsPageResponse)
def operation_log_streams(
    scope_type: str | None = None,
    scope_id: int | None = Query(default=None, ge=1),
    source_id: int | None = Query(default=None, ge=1),
    scan_run_id: int | None = Query(default=None, ge=1),
    level: str | None = None,
    keyword: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, object]:
    """按作用域和关键字等条件分页查询日志流。"""

    try:
        return list_operation_log_streams(
            scope_type=scope_type,
            scope_id=scope_id,
            source_id=source_id,
            scan_run_id=scan_run_id,
            level=level,
            keyword=keyword,
            limit=limit,
            offset=offset,
        )
    except ValueError as exc:
        raise_api_error(exc)


@router.get("/{stream_id}", response_model=OperationLogEntriesResponse)
def operation_log_entries(
    stream_id: int,
    cursor: int | None = Query(default=None, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    level: list[str] | None = Query(default=None),
) -> dict[str, object]:
    """按游标读取指定日志流中的日志条目。"""

    try:
        return read_operation_log_entries(
            stream_id,
            cursor=cursor,
            limit=limit,
            levels=set(level) if level else None,
        )
    except ValueError as exc:
        if str(exc) == "log_stream_not_found":
            raise HTTPException(status_code=404, detail="log_stream_not_found") from exc
        raise_api_error(exc)
