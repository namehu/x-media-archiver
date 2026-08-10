"""来源批量任务与定时策略路由。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Response, status

from xarchiver.api.deps import execute_write_action, raise_api_error
from xarchiver.api.schemas.requests import (
    SourceBulkTaskControlRequest,
    SourceBulkTaskCreateRequest,
    SourceBulkTaskRetryRequest,
    SourceSchedulePolicyAssignRequest,
    SourceSchedulePolicyCreateRequest,
    SourceSchedulePolicyUpdateRequest,
)
from xarchiver.api.schemas.responses import (
    SourceBulkTaskResponse,
    SourceBulkTasksPageResponse,
    SourceSchedulePolicyResponse,
)
from xarchiver.services.source_bulk_tasks import (
    assign_source_schedule_policy,
    control_source_bulk_task,
    create_source_bulk_task,
    create_source_schedule_policy,
    delete_source_schedule_policy,
    get_source_bulk_task,
    get_source_schedule_policy,
    list_source_bulk_tasks,
    list_source_schedule_policies,
    retry_source_bulk_task,
    update_source_schedule_policy,
)

router = APIRouter(tags=["source-tasks"])


@router.post(
    "/source-bulk-tasks",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=SourceBulkTaskResponse,
)
def create_bulk_task(request: SourceBulkTaskCreateRequest) -> dict[str, object]:
    """创建来源批量任务，并立即冻结来源成员。"""

    try:
        return execute_write_action(
            "source-bulk-task-create",
            lambda: create_source_bulk_task(
                request.task_type,
                source_ids=request.source_ids,
                source_filter=request.source_filter.model_dump(exclude_none=True) if request.source_filter else None,
                options={"confirm_large_download": request.confirm_large_download},
            ),
            scope="sources",
        )["result"]
    except ValueError as exc:
        raise_api_error(exc)


@router.get("/source-bulk-tasks", response_model=SourceBulkTasksPageResponse)
def bulk_tasks(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict[str, object]:
    """分页查询批量任务。"""

    return list_source_bulk_tasks(limit=limit, offset=offset)


@router.get("/source-bulk-tasks/{task_id}", response_model=SourceBulkTaskResponse)
def bulk_task_detail(task_id: int) -> dict[str, object]:
    """查询任务及逐来源结果。"""

    result = get_source_bulk_task(task_id)
    if result is None:
        raise HTTPException(status_code=404, detail="source_bulk_task_not_found")
    return result


@router.post("/source-bulk-tasks/{task_id}/control", response_model=SourceBulkTaskResponse)
def control_bulk_task(task_id: int, request: SourceBulkTaskControlRequest) -> dict[str, object]:
    """暂停、恢复或取消任务。"""

    try:
        return execute_write_action(
            "source-bulk-task-control",
            lambda: control_source_bulk_task(task_id, request.action),
            scope="sources",
        )["result"]
    except ValueError as exc:
        raise_api_error(
            exc,
            default_status=404 if str(exc) == "source_bulk_task_not_found" else 409,
        )


@router.post(
    "/source-bulk-tasks/{task_id}/retry",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=SourceBulkTaskResponse,
)
def retry_bulk_task(task_id: int, request: SourceBulkTaskRetryRequest) -> dict[str, object]:
    """仅使用失败来源创建重试任务。"""

    try:
        return execute_write_action(
            "source-bulk-task-retry",
            lambda: retry_source_bulk_task(
                task_id,
                confirm_large_download=request.confirm_large_download,
            ),
            scope="sources",
        )["result"]
    except ValueError as exc:
        raise_api_error(
            exc,
            default_status=404 if str(exc) == "source_bulk_task_not_found" else 409,
        )


@router.get("/source-schedule-policies", response_model=list[SourceSchedulePolicyResponse])
def schedule_policies() -> list[dict[str, object]]:
    """列出所有来源定时策略。"""

    return list_source_schedule_policies()


@router.post(
    "/source-schedule-policies",
    status_code=status.HTTP_201_CREATED,
    response_model=SourceSchedulePolicyResponse,
)
def create_schedule_policy(request: SourceSchedulePolicyCreateRequest) -> dict[str, object]:
    """创建默认关闭的命名策略，或按请求明确启用。"""

    try:
        return execute_write_action(
            "source-schedule-create",
            lambda: create_source_schedule_policy(**request.model_dump()),
            scope="sources",
        )["result"]
    except ValueError as exc:
        raise_api_error(exc)


@router.get("/source-schedule-policies/{policy_id}", response_model=SourceSchedulePolicyResponse)
def schedule_policy_detail(policy_id: int) -> dict[str, object]:
    """查询策略及成员快照。"""

    result = get_source_schedule_policy(policy_id)
    if result is None:
        raise HTTPException(status_code=404, detail="source_schedule_policy_not_found")
    return result


@router.patch("/source-schedule-policies/{policy_id}", response_model=SourceSchedulePolicyResponse)
def update_schedule_policy(
    policy_id: int,
    request: SourceSchedulePolicyUpdateRequest,
) -> dict[str, object]:
    """更新策略配置并重算下一次执行。"""

    try:
        return execute_write_action(
            "source-schedule-update",
            lambda: update_source_schedule_policy(policy_id, request.model_dump(exclude_unset=True)),
            scope="sources",
        )["result"]
    except ValueError as exc:
        raise_api_error(
            exc,
            default_status=404 if str(exc) == "source_schedule_policy_not_found" else 400,
        )


@router.put("/source-schedule-policies/{policy_id}/sources", response_model=SourceSchedulePolicyResponse)
def assign_schedule_policy(
    policy_id: int,
    request: SourceSchedulePolicyAssignRequest,
) -> dict[str, object]:
    """替换策略的来源成员。"""

    try:
        return execute_write_action(
            "source-schedule-assign",
            lambda: assign_source_schedule_policy(policy_id, request.source_ids),
            scope="sources",
        )["result"]
    except ValueError as exc:
        raise_api_error(
            exc,
            default_status=404 if str(exc) == "source_schedule_policy_not_found" else 400,
        )


@router.delete("/source-schedule-policies/{policy_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_schedule_policy(policy_id: int) -> Response:
    """删除策略但保留历史任务。"""

    try:
        execute_write_action(
            "source-schedule-delete",
            lambda: delete_source_schedule_policy(policy_id),
            scope="sources",
        )
    except ValueError as exc:
        raise_api_error(exc, default_status=404)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
