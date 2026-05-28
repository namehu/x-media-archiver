from __future__ import annotations

from contextlib import asynccontextmanager
import logging
from threading import Thread

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from xarchiver.api.deps import stop_worker, write_action_lock
from xarchiver.api.v1 import actions, archive_runs, library, maintenance, misc, sources
from xarchiver.config import get_settings
from xarchiver.core.errors import ArchiverError, error_response_payload
from xarchiver.services.queue import process_next_queued_run
from xarchiver.services.sources import process_next_source_history_scan, recover_interrupted_source_scan_runs

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

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(library.router, prefix="/api/v1")
    app.include_router(archive_runs.router, prefix="/api/v1")
    app.include_router(sources.router, prefix="/api/v1")
    app.include_router(actions.router, prefix="/api/v1")
    app.include_router(maintenance.router, prefix="/api/v1")
    app.include_router(misc.router, prefix="/api/v1")

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
