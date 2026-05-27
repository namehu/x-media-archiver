from __future__ import annotations

from contextlib import asynccontextmanager
from collections.abc import Callable
from pathlib import Path
from threading import Event, Lock, Thread

from fastapi import FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from xarchiver.config import get_settings
from xarchiver.services.failures import list_failures
from xarchiver.services.inbox import (
    get_scheduler_settings,
    list_inbox_imports,
    process_inbox_import,
    process_pending_imports,
    run_inbox_cycle,
    scan_inbox,
    scheduler_due,
    update_scheduler_settings,
)
from xarchiver.services.library import get_summary, get_tweet_detail, list_duplicates, list_media
from xarchiver.services.runs import (
    run_archive_urls,
    run_backfill,
    run_export_duplicates,
    run_export_failures,
    run_export_media,
    run_recover_interrupted,
    run_requeue,
    run_verify,
)

write_action_lock = Lock()
stop_scheduler = Event()


class VerifyRequest(BaseModel):
    limit: int | None = Field(default=None, ge=1)
    confirm_full_scan: bool = False


class BackfillRequest(BaseModel):
    confirm_full_scan: bool = False
    normalize_files: bool = True


class RequeueRequest(BaseModel):
    statuses: list[str] | None = None
    limit: int | None = Field(default=None, ge=1)


class RecoverInterruptedRequest(BaseModel):
    timeout_minutes: int | None = Field(default=None, ge=1)


class ExportRequest(BaseModel):
    kind: str = Field(default="media", pattern="^(media|failures|duplicates)$")
    status: str | None = "verified"


class ArchiveUrlsRequest(BaseModel):
    path: str
    limit: int | None = Field(default=None, ge=1)


class InboxProcessRequest(BaseModel):
    limit: int | None = Field(default=None, ge=1)


class InboxSchedulerRequest(BaseModel):
    enabled: bool
    interval_minutes: int = Field(default=15, ge=1, le=1440)


@asynccontextmanager
async def app_lifespan(_: FastAPI):
    stop_scheduler.clear()
    worker = Thread(target=scheduler_loop, name="inbox-scheduler", daemon=True)
    worker.start()
    try:
        yield
    finally:
        stop_scheduler.set()
        worker.join(timeout=2)


def create_app() -> FastAPI:
    app = FastAPI(title="x-media-archiver local API", version="0.2.0", lifespan=app_lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ],
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/summary")
    def summary() -> dict[str, object]:
        return get_summary(get_settings())

    @app.get("/api/media")
    def media(
        author: str | None = None,
        text: str | None = None,
        tweet_status: str | None = None,
        media_status: str | None = Query("verified"),
        media_type: str | None = None,
        limit: int = Query(50, ge=1, le=200),
    ) -> dict[str, object]:
        rows = list_media(
            get_settings(),
            author=author,
            text=text,
            tweet_status=tweet_status,
            media_status=media_status,
            media_type=media_type,
            limit=limit,
        )
        return {"rows": rows, "count": len(rows)}

    @app.get("/api/tweets/{tweet_id}")
    def tweet_detail(tweet_id: str) -> dict[str, object]:
        detail = get_tweet_detail(get_settings(), tweet_id)
        if detail is None:
            raise HTTPException(status_code=404, detail="tweet_not_found")
        return detail

    @app.get("/api/failures")
    def failures(limit: int = Query(100, ge=1, le=500)) -> dict[str, object]:
        rows = list_failures(limit)
        return {"rows": rows, "count": len(rows)}

    @app.get("/api/duplicates")
    def duplicates() -> dict[str, object]:
        return list_duplicates(get_settings())

    @app.get("/api/media-file/{relative_path:path}")
    def media_file(relative_path: str) -> FileResponse:
        settings = get_settings()
        target = resolve_archive_file(settings.archive_dir, relative_path)
        if not target.exists() or not target.is_file():
            raise HTTPException(status_code=404, detail="media_file_not_found")
        return FileResponse(target)

    @app.post("/api/actions/verify")
    def verify_action(request: VerifyRequest) -> dict[str, object]:
        require_full_scan_confirmation(request.confirm_full_scan)
        return execute_write_action("verify", lambda: run_verify(request.limit))

    @app.post("/api/actions/requeue")
    def requeue_action(request: RequeueRequest) -> dict[str, object]:
        return execute_write_action("requeue", lambda: run_requeue(request.statuses, request.limit))

    @app.post("/api/actions/recover-interrupted")
    def recover_interrupted_action(request: RecoverInterruptedRequest) -> dict[str, object]:
        settings = get_settings()
        return execute_write_action(
            "recover-interrupted",
            lambda: run_recover_interrupted(settings, request.timeout_minutes),
        )

    @app.post("/api/actions/export")
    def export_action(request: ExportRequest) -> dict[str, object]:
        settings = get_settings()

        def run_export() -> dict[str, object]:
            if request.kind == "failures":
                return run_export_failures(settings)
            if request.kind == "duplicates":
                return run_export_duplicates(settings)
            return run_export_media(settings, status=None if request.status == "all" else request.status)

        return execute_write_action(f"export-{request.kind}", run_export)

    @app.post("/api/maintenance/backfill")
    def maintenance_backfill(request: BackfillRequest) -> dict[str, object]:
        require_full_scan_confirmation(request.confirm_full_scan)
        settings = get_settings()
        return execute_write_action(
            "maintenance-backfill",
            lambda: run_backfill(settings, request.normalize_files),
        )

    @app.post("/api/maintenance/verify")
    def maintenance_verify(request: VerifyRequest) -> dict[str, object]:
        require_full_scan_confirmation(request.confirm_full_scan)
        return execute_write_action("maintenance-verify", lambda: run_verify(request.limit))

    @app.post("/api/runs/archive-urls")
    def archive_urls_run(request: ArchiveUrlsRequest) -> dict[str, object]:
        settings = get_settings()
        input_path = Path(request.path)
        if not input_path.exists() or not input_path.is_file():
            raise HTTPException(status_code=404, detail="input_file_not_found")
        return execute_write_action("archive-urls", lambda: run_archive_urls(input_path, settings, request.limit))

    @app.get("/api/inbox")
    def inbox(
        inbox_status: str | None = Query(default=None, alias="status"),
        limit: int = Query(100, ge=1, le=500),
    ) -> dict[str, object]:
        rows = list_inbox_imports(inbox_status, limit)
        return {"rows": rows, "count": len(rows)}

    @app.post("/api/inbox/scan")
    def inbox_scan() -> dict[str, object]:
        settings = get_settings()
        return execute_write_action("inbox-scan", lambda: scan_inbox(settings))

    @app.post("/api/inbox/process-pending")
    def inbox_process_pending(request: InboxProcessRequest) -> dict[str, object]:
        settings = get_settings()
        return execute_write_action(
            "inbox-process-pending",
            lambda: process_pending_imports(settings, request.limit),
        )

    @app.post("/api/inbox/{import_id}/process")
    def inbox_process(import_id: int, request: InboxProcessRequest) -> dict[str, object]:
        settings = get_settings()
        try:
            return execute_write_action(
                "inbox-process",
                lambda: process_inbox_import(import_id, settings, request.limit),
            )
        except ValueError as exc:
            if str(exc) == "inbox_import_not_processable":
                raise HTTPException(status_code=409, detail=str(exc)) from exc
            raise

    @app.get("/api/inbox/settings")
    def inbox_settings() -> dict[str, object]:
        return get_scheduler_settings()

    @app.post("/api/inbox/settings")
    def inbox_settings_update(request: InboxSchedulerRequest) -> dict[str, object]:
        return update_scheduler_settings(request.enabled, request.interval_minutes)

    return app


def scheduler_loop() -> None:
    while not stop_scheduler.wait(5):
        try:
            settings_row = get_scheduler_settings()
            if not scheduler_due(settings_row):
                continue
            settings = get_settings()
            execute_write_action("inbox-auto-process", lambda: run_inbox_cycle(settings))
        except HTTPException as exc:
            if exc.status_code != status.HTTP_409_CONFLICT:
                continue
        except Exception:
            continue


def execute_write_action(name: str, action: Callable[[], dict[str, object]]) -> dict[str, object]:
    if not write_action_lock.acquire(blocking=False):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="write_action_in_progress",
        )
    try:
        result = action()
        return {"action": name, "status": "completed", "result": result}
    finally:
        write_action_lock.release()


def require_full_scan_confirmation(confirmed: bool) -> None:
    if not confirmed:
        raise HTTPException(status_code=400, detail="full_scan_confirmation_required")


def resolve_archive_file(archive_dir: Path, relative_path: str) -> Path:
    base = archive_dir.resolve()
    target = (base / relative_path).resolve()
    if base != target and base not in target.parents:
        raise HTTPException(status_code=400, detail="invalid_media_path")
    return target


app = create_app()
