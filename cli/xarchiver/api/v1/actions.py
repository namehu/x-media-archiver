from __future__ import annotations

from fastapi import APIRouter

from xarchiver.api.deps import execute_write_action, require_full_scan_confirmation
from xarchiver.api.schemas import (
    ExportRequest,
    RecoverInterruptedRequest,
    RequeueRequest,
    VerifyRequest,
    WriteActionResponse,
)
from xarchiver.config import get_settings
from xarchiver.services.runs import (
    run_export_duplicates,
    run_export_failures,
    run_export_media,
    run_recover_interrupted,
    run_requeue,
    run_verify,
)

router = APIRouter(prefix="/actions", tags=["actions"])


@router.post("/verify", response_model=WriteActionResponse)
def verify_action(request: VerifyRequest) -> dict[str, object]:
    require_full_scan_confirmation(request.confirm_full_scan)
    return execute_write_action("verify", lambda: run_verify(request.limit))


@router.post("/requeue", response_model=WriteActionResponse)
def requeue_action(request: RequeueRequest) -> dict[str, object]:
    return execute_write_action("requeue", lambda: run_requeue(request.statuses, request.limit))


@router.post("/recover-interrupted", response_model=WriteActionResponse)
def recover_interrupted_action(request: RecoverInterruptedRequest) -> dict[str, object]:
    settings = get_settings()
    return execute_write_action(
        "recover-interrupted",
        lambda: run_recover_interrupted(settings, request.timeout_minutes),
    )


@router.post("/export", response_model=WriteActionResponse)
def export_action(request: ExportRequest) -> dict[str, object]:
    settings = get_settings()

    def run_export() -> dict[str, object]:
        if request.kind == "failures":
            return run_export_failures(settings)
        if request.kind == "duplicates":
            return run_export_duplicates(settings)
        return run_export_media(settings, status=None if request.status == "all" else request.status)

    return execute_write_action(f"export-{request.kind}", run_export)
