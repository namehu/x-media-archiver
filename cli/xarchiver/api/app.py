from __future__ import annotations

from contextlib import asynccontextmanager
import logging
import os
from pathlib import Path
import socket
from threading import Thread
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from xarchiver.api.deps import stop_worker
from xarchiver.api.middleware import RequestIdMiddleware, configure_api_logging
from xarchiver.api.v1 import actions, archive_runs, library, maintenance, misc, sources
from xarchiver.config import get_settings
from xarchiver.core.errors import ArchiverError, error_response_payload
from xarchiver.core.lock_manager import lock_manager
from xarchiver.db import close_pool, open_pool
from xarchiver.services.queue import count_expired_archive_item_leases, process_next_queued_run
from xarchiver.services.sources import recover_expired_source_scan_leases, process_next_source_history_scan

logger = logging.getLogger(__name__)


@asynccontextmanager
async def app_lifespan(_: FastAPI):
    stop_worker.clear()
    open_pool()
    worker_id = make_worker_id()
    expired_items = count_expired_archive_item_leases()
    expired_scans = recover_expired_source_scan_leases()
    if expired_items or expired_scans:
        logger.warning(
            "Found expired worker leases on startup.",
            extra={
                "event": "worker.lease.expired_found",
                "details": {"archive_items": expired_items, "source_scans": expired_scans},
            },
        )
    workers = [
        Thread(target=queue_worker_loop, args=(worker_id,), name="archive-queue-worker", daemon=True),
        Thread(target=source_worker_loop, args=(worker_id,), name="source-scan-worker", daemon=True),
    ]
    for worker in workers:
        worker.start()
    try:
        yield
    finally:
        stop_worker.set()
        for worker in workers:
            worker.join(timeout=2)
        close_pool()


def create_app() -> FastAPI:
    configure_api_logging()
    app = FastAPI(title="x-media-archiver local API", version="0.2.0", lifespan=app_lifespan)
    app.add_middleware(RequestIdMiddleware)
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

    mount_webui(app)

    return app


def mount_webui(app: FastAPI) -> None:
    """Serve the built WebUI from the same origin when its dist directory is present.

    The catch-all is registered after the API routers so /api/v1/* and /health keep
    priority. When the dist directory is absent (local dev, backend tests) nothing is
    mounted and the API behaves exactly as before.
    """
    dist = Path(os.environ.get("WEBUI_DIST", "/app/webui"))
    index_file = dist / "index.html"
    if not index_file.is_file():
        return

    assets_dir = dist / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str) -> FileResponse:
        # API and health routes are matched earlier; anything reaching here that
        # still looks like an API path must 404 as JSON, not fall back to index.html.
        if full_path == "health" or full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="not_found")
        candidate = (dist / full_path).resolve()
        if dist.resolve() in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index_file)


def make_worker_id() -> str:
    return f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:8]}"


def queue_worker_loop(worker_id: str | None = None) -> None:
    worker_id = worker_id or make_worker_id()
    while not stop_worker.wait(2):
        try:
            if lock_manager.locked("global"):
                continue
            process_next_queued_run(get_settings(), worker_id=worker_id)
        except Exception:
            logger.exception("Queue worker iteration failed.")


def source_worker_loop(worker_id: str | None = None) -> None:
    worker_id = worker_id or make_worker_id()
    while not stop_worker.wait(2):
        try:
            if lock_manager.locked("global"):
                continue
            process_next_source_history_scan(get_settings(), worker_id=worker_id)
        except Exception:
            logger.exception("Source scan worker iteration failed.")


app = create_app()
