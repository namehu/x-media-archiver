from __future__ import annotations

from contextlib import asynccontextmanager
from collections.abc import Callable
import logging
from pathlib import Path
from threading import Event, Lock, Thread

from fastapi import FastAPI, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from xarchiver.config import get_settings
from xarchiver.core.errors import ArchiverError, error_response_payload, http_status_for_error_code
from xarchiver.services.failures import list_failures
from xarchiver.services.library import get_summary, get_tweet_detail, list_duplicates, list_media
from xarchiver.services.queue import get_run_detail, list_runs, process_next_queued_run, retry_run, submit_archive_batch
from xarchiver.services.runs import (
    run_backfill,
    run_export_duplicates,
    run_export_failures,
    run_export_media,
    run_recover_interrupted,
    run_requeue,
    run_verify,
)
from xarchiver.services.sources import (
    create_source,
    get_source,
    list_sources,
    process_next_source_history_scan,
    recover_interrupted_source_scan_runs,
    scan_source,
    start_source_history_scan,
    stop_source_history_scan,
    submit_discovered_tweets,
    submit_source_records,
    update_source_status,
)

write_action_lock = Lock()
stop_worker = Event()
logger = logging.getLogger(__name__)


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


class ArchiveRecord(BaseModel):
    url: str
    author_username: str | None = None
    author_display_name: str | None = None
    text: str | None = None
    published_at: str | None = None
    datetime: str | None = None
    collected_at: str | None = None
    source_url: str | None = None


class ArchiveSubmitRequest(BaseModel):
    trigger_type: str = "webui"
    records: list[ArchiveRecord]


class SourceCreateRequest(BaseModel):
    source_type: str = Field(pattern="^(profile|user_media|likes|bookmarks|search|manual)$")
    source_url: str
    label: str | None = None
    author_username: str | None = None


class SourceRecordsRequest(BaseModel):
    records: list[ArchiveRecord]


class SourceStatusRequest(BaseModel):
    status: str = Field(pattern="^(active|paused|completed|failed)$")


class SourceScanRequest(BaseModel):
    limit: int = Field(default=20, ge=1, le=200)
    restart: bool = False


class SourceSubmitDiscoveredRequest(BaseModel):
    limit: int | None = Field(default=None, ge=1, le=500)


class SourceHistoryScanRequest(BaseModel):
    limit: int = Field(default=20, ge=1, le=200)
    restart: bool = False


@asynccontextmanager
async def app_lifespan(_: FastAPI):
    stop_worker.clear()
    recovered_scans = recover_interrupted_source_scan_runs()
    if recovered_scans:
        logger.warning("Marked %s interrupted source scan batch(es) as failed.", recovered_scans)
    workers = [
        Thread(target=queue_worker_loop, name="archive-queue-worker", daemon=True),
        Thread(target=source_worker_loop, name="source-scan-worker", daemon=True),
    ]
    for worker in workers:
        worker.start()
    try:
        yield
    finally:
        stop_worker.set()
        for worker in workers:
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

    @app.exception_handler(ArchiverError)
    async def archiver_error_handler(_: Request, exc: ArchiverError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.http_status,
            content=error_response_payload(exc.code, message=str(exc), category=exc.category),
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        if isinstance(exc.detail, str):
            content = error_response_payload(exc.detail)
        else:
            content = {
                "detail": exc.detail,
                "code": "http_error",
                "message": str(exc.detail),
                "category": None,
            }
        return JSONResponse(status_code=exc.status_code, content=content, headers=exc.headers)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/summary")
    def summary() -> dict[str, object]:
        return get_summary(get_settings())

    @app.get("/api/settings/download-policy")
    def download_policy() -> dict[str, object]:
        settings = get_settings()
        return {
            "queue_batch_size": settings.queue_batch_size,
            "downloader_sleep_min_seconds": settings.downloader_sleep_min_seconds,
            "downloader_sleep_max_seconds": settings.downloader_sleep_max_seconds,
            "default_download_engine": settings.default_download_engine,
            "source_scan_batch_size": settings.source_scan_batch_size,
            "source_scan_sleep_min_seconds": settings.source_scan_sleep_min_seconds,
            "source_scan_sleep_max_seconds": settings.source_scan_sleep_max_seconds,
        }

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

    @app.post("/api/archive-runs", status_code=status.HTTP_202_ACCEPTED)
    def submit_run(request: ArchiveSubmitRequest) -> dict[str, object]:
        try:
            return submit_archive_batch(
                [record.model_dump() for record in request.records],
                request.trigger_type,
            )
        except ValueError as exc:
            raise_api_error(exc)

    @app.get("/api/archive-runs")
    def archive_runs(
        limit: int = Query(50, ge=1, le=200),
        run_status: str | None = None,
        tweet_id: str | None = None,
        failed_only: bool = False,
    ) -> dict[str, object]:
        rows = list_runs(limit, status=run_status, tweet_id=tweet_id, failed_only=failed_only)
        return {"rows": rows, "count": len(rows)}

    @app.get("/api/archive-runs/{run_id}")
    def archive_run_detail(run_id: int) -> dict[str, object]:
        result = get_run_detail(run_id)
        if result is None:
            raise HTTPException(status_code=404, detail="archive_run_not_found")
        return result

    @app.post("/api/archive-runs/{run_id}/retry", status_code=status.HTTP_202_ACCEPTED)
    def retry_archive_run(run_id: int) -> dict[str, object]:
        try:
            return retry_run(run_id)
        except ValueError as exc:
            raise_api_error(exc, default_status=409)

    @app.post("/api/sources", status_code=status.HTTP_201_CREATED)
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

    @app.get("/api/sources")
    def archive_sources(
        limit: int = Query(50, ge=1, le=200),
        source_status: str | None = None,
        source_type: str | None = None,
    ) -> dict[str, object]:
        try:
            rows = list_sources(status=source_status, source_type=source_type, limit=limit)
        except ValueError as exc:
            raise_api_error(exc)
        return {"rows": rows, "count": len(rows)}

    @app.get("/api/sources/{source_id}")
    def archive_source_detail(source_id: int) -> dict[str, object]:
        result = get_source(source_id)
        if result is None:
            raise HTTPException(status_code=404, detail="source_not_found")
        return result

    @app.post("/api/sources/{source_id}/records", status_code=status.HTTP_202_ACCEPTED)
    def submit_archive_source_records(source_id: int, request: SourceRecordsRequest) -> dict[str, object]:
        try:
            return submit_source_records(source_id, [record.model_dump() for record in request.records])
        except ValueError as exc:
            raise_api_error(exc)

    @app.post("/api/sources/{source_id}/submit-discovered", status_code=status.HTTP_202_ACCEPTED)
    def submit_archive_source_discovered(
        source_id: int,
        request: SourceSubmitDiscoveredRequest,
    ) -> dict[str, object]:
        try:
            return submit_discovered_tweets(source_id, limit=request.limit)
        except ValueError as exc:
            raise_api_error(exc, default_status=409)

    @app.post("/api/sources/{source_id}/status")
    def update_archive_source_status(source_id: int, request: SourceStatusRequest) -> dict[str, object]:
        try:
            return update_source_status(source_id, request.status)
        except ValueError as exc:
            raise_api_error(exc)

    @app.post("/api/sources/{source_id}/scan", status_code=status.HTTP_202_ACCEPTED)
    def scan_archive_source(source_id: int, request: SourceScanRequest) -> dict[str, object]:
        try:
            return execute_write_action("source-scan", lambda: scan_source(source_id, request.limit, restart=request.restart))
        except ValueError as exc:
            raise_api_error(exc)

    @app.post("/api/sources/{source_id}/history-scan", status_code=status.HTTP_202_ACCEPTED)
    def start_archive_source_history_scan(source_id: int, request: SourceHistoryScanRequest) -> dict[str, object]:
        try:
            return start_source_history_scan(source_id, request.limit, request.restart)
        except ValueError as exc:
            raise_api_error(exc)

    @app.post("/api/sources/{source_id}/history-scan/stop")
    def stop_archive_source_history_scan(source_id: int) -> dict[str, object]:
        try:
            return stop_source_history_scan(source_id)
        except ValueError as exc:
            raise_api_error(exc, default_status=404)

    return app


def queue_worker_loop() -> None:
    while not stop_worker.wait(2):
        try:
            if not write_action_lock.acquire(blocking=False):
                continue
            try:
                process_next_queued_run(get_settings())
            finally:
                write_action_lock.release()
        except Exception:
            logger.exception("Queue worker iteration failed.")


def source_worker_loop() -> None:
    while not stop_worker.wait(2):
        try:
            if not write_action_lock.acquire(blocking=False):
                continue
            try:
                process_next_source_history_scan(get_settings())
            finally:
                write_action_lock.release()
        except Exception:
            logger.exception("Source scan worker iteration failed.")


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


def raise_api_error(error: ArchiverError | ValueError, *, default_status: int = 400) -> None:
    if isinstance(error, ArchiverError):
        raise HTTPException(status_code=error.http_status, detail=error.code) from error
    detail = str(error)
    raise HTTPException(
        status_code=http_status_for_error_code(detail, default=default_status),
        detail=detail,
    ) from error


app = create_app()
