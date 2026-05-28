from __future__ import annotations

from fastapi import APIRouter

from xarchiver.api.deps import execute_write_action, require_full_scan_confirmation
from xarchiver.api.schemas import BackfillRequest, VerifyRequest, WriteActionResponse
from xarchiver.config import get_settings
from xarchiver.services.runs import run_backfill, run_verify

router = APIRouter(prefix="/maintenance", tags=["maintenance"])


@router.post("/backfill", response_model=WriteActionResponse)
def maintenance_backfill(request: BackfillRequest) -> dict[str, object]:
    require_full_scan_confirmation(request.confirm_full_scan)
    settings = get_settings()
    return execute_write_action(
        "maintenance-backfill",
        lambda: run_backfill(settings, request.normalize_files),
    )


@router.post("/verify", response_model=WriteActionResponse)
def maintenance_verify(request: VerifyRequest) -> dict[str, object]:
    require_full_scan_confirmation(request.confirm_full_scan)
    return execute_write_action("maintenance-verify", lambda: run_verify(request.limit))
