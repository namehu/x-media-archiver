from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import logging
from threading import Thread

from fastapi import FastAPI, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from xarchiver.api.deps import (
    execute_write_action,
    parse_event_topics,
    raise_api_error,
    require_full_scan_confirmation,
    resolve_archive_file,
    stop_worker,
    write_action_lock,
)
from xarchiver.api.schemas import (
    ArchiveRecord,
    ArchiveSubmitRequest,
    BackfillRequest,
    ExportRequest,
    RecoverInterruptedRequest,
    RequeueRequest,
    SourceCreateRequest,
    SourceHistoryScanRequest,
    SourceRecordsRequest,
    SourceScanRequest,
    SourceStatusRequest,
    SourceSubmitDiscoveredRequest,
    VerifyRequest,
)
from xarchiver.api.v1 import actions, archive_runs, library, maintenance, misc, sources
from xarchiver.config import get_settings
from xarchiver.core.errors import ArchiverError, error_response_payload
from xarchiver.core.events import event_broker, format_sse_event
from xarchiver.services.failures import list_failures
from xarchiver.services.library import get_summary, get_tweet_detail, list_duplicates_page, list_media_page
from xarchiver.services.queue import get_run_detail, list_runs_page, process_next_queued_run, retry_run, submit_archive_batch
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
    list_sources_page,
    process_next_source_history_scan,
    recover_interrupted_source_scan_runs,
    scan_source,
    start_source_history_scan,
    stop_source_history_scan,
    submit_discovered_tweets,
    submit_source_records,
    update_source_status,
)

logger = logging.getLogger(__name__)


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

    # v1 routers — canonical versioned API
    app.include_router(library.router, prefix="/api/v1")
    app.include_router(archive_runs.router, prefix="/api/v1")
    app.include_router(sources.router, prefix="/api/v1")
    app.include_router(actions.router, prefix="/api/v1")
    app.include_router(maintenance.router, prefix="/api/v1")
    app.include_router(misc.router, prefix="/api/v1")

    # ── Legacy /api/* routes — kept for WebUI backward compat, removed in P3.6 ──

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/events")
    async def events(request: Request, topics: str | None = None) -> StreamingResponse:
        subscription = event_broker.subscribe(parse_event_topics(topics))

        async def event_stream():
            try:
                yield ": connected\n\n"
                while not await request.is_disconnected():
                    try:
                        event = await asyncio.to_thread(subscription.get, 15.0)
                    except Exception:
                        yield ": keepalive\n\n"
                        continue
                    yield format_sse_event(event)
            finally:
                subscription.close()

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

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
        offset: int = Query(0, ge=0),
    ) -> dict[str, object]:
        return list_media_page(
            get_settings(),
            author=author,
            text=text,
            tweet_status=tweet_status,
            media_status=media_status,
            media_type=media_type,
            limit=limit,
            offset=offset,
        )

    @app.get("/api/tweets/{tweet_id}")
    def tweet_detail(tweet_id: str) -> dict[str, object]:
        detail = get_tweet_detail(get_settings(), tweet_id)
        if detail is None:
            raise HTTPException(status_code=404, detail="tweet_not_found")
        return detail

    @app.get("/api/failures")
    def failures(
        limit: int = Query(100, ge=1, le=500),
        offset: int = Query(0, ge=0),
    ) -> dict[str, object]:
        return list_failures(limit=limit, offset=offset)

    @app.get("/api/duplicates")
    def duplicates(
        limit: int = Query(100, ge=1, le=500),
        offset: int = Query(0, ge=0),
    ) -> dict[str, object]:
        return list_duplicates_page(get_settings(), limit=limit, offset=offset)

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
    def archive_runs_list(
        limit: int = Query(50, ge=1, le=200),
        offset: int = Query(0, ge=0),
        run_status: str | None = None,
        tweet_id: str | None = None,
        failed_only: bool = False,
    ) -> dict[str, object]:
        return list_runs_page(limit=limit, offset=offset, status=run_status, tweet_id=tweet_id, failed_only=failed_only)

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
        offset: int = Query(0, ge=0),
        source_status: str | None = None,
        source_type: str | None = None,
    ) -> dict[str, object]:
        try:
            return list_sources_page(status=source_status, source_type=source_type, limit=limit, offset=offset)
        except ValueError as exc:
            raise_api_error(exc)

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


app = create_app()
