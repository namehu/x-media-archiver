"""FastAPI 应用装配入口。

负责应用生命周期、后台 worker 启停、中间件挂载、统一异常处理，以及
在存在构建产物时把 WebUI 作为同源静态站点挂到同一个进程上。
"""

from __future__ import annotations

import logging
import os
import socket
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from threading import Thread

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from xarchiver.api.deps import stop_worker
from xarchiver.api.middleware import (
    LOCAL_DEV_ORIGINS,
    AuthMiddleware,
    RequestIdMiddleware,
    configure_api_logging,
)
from xarchiver.api.v1 import (
    actions,
    archive_runs,
    auth,
    library,
    log_streams,
    maintenance,
    misc,
    runtime_ws,
    settings,
    source_tasks,
    sources,
)
from xarchiver.config import get_settings
from xarchiver.core.errors import ArchiverError, error_response_payload
from xarchiver.core.lock_manager import lock_manager
from xarchiver.db import close_pool, open_pool
from xarchiver.services.auth import initialize_setup_token
from xarchiver.services.queue import (
    count_expired_archive_item_leases,
    has_runnable_download_work,
    process_next_queued_run,
)
from xarchiver.services.source_bulk_tasks import (
    advance_source_bulk_tasks,
    has_due_source_scan,
)
from xarchiver.services.sources import (
    process_next_source_history_scan,
    recover_expired_source_scan_leases,
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def app_lifespan(_: FastAPI):
    """管理数据库连接池、后台 worker 与启动时恢复逻辑。"""

    stop_worker.clear()
    open_pool()
    settings = get_settings()
    if settings.auth_mode == "disabled":
        logger.warning("Authentication is disabled; all Web/API routes are publicly accessible.")
    else:
        setup_token = initialize_setup_token(settings)
        if setup_token:
            logger.warning("Admin is not initialized. One-time setup token: %s", setup_token)
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
        Thread(target=network_worker_loop, args=(worker_id,), name="archive-network-worker", daemon=True),
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
    """创建并配置 FastAPI 应用实例。"""

    configure_api_logging()
    app = FastAPI(title="x-media-archiver local API", version="0.2.0", lifespan=app_lifespan)
    app.add_middleware(AuthMiddleware)
    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=sorted(LOCAL_DEV_ORIGINS),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
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

    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(library.router, prefix="/api/v1")
    app.include_router(archive_runs.router, prefix="/api/v1")
    app.include_router(sources.router, prefix="/api/v1")
    app.include_router(source_tasks.router, prefix="/api/v1")
    app.include_router(log_streams.router, prefix="/api/v1")
    app.include_router(actions.router, prefix="/api/v1")
    app.include_router(maintenance.router, prefix="/api/v1")
    app.include_router(misc.router, prefix="/api/v1")
    app.include_router(runtime_ws.router, prefix="/api/v1")
    app.include_router(settings.router, prefix="/api/v1")

    mount_webui(app)

    return app


def mount_webui(app: FastAPI) -> None:
    """当存在 WebUI 构建产物时，以同源方式挂载静态站点。

    这个兜底路由会放在 API 路由之后注册，因此 `/api/v1/*` 和 `/health`
    仍然优先命中后端接口。若 dist 目录不存在，则不挂载任何静态资源，
    API 行为保持不变。
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
        # API 和 health 会更早命中；如果还能走到这里但路径仍像 API，
        # 就必须返回 JSON 404，而不是错误地回退到 index.html。
        if full_path == "health" or full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="not_found")
        candidate = (dist / full_path).resolve()
        if dist.resolve() in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index_file)


def make_worker_id() -> str:
    """生成一个进程内唯一的 worker 标识。"""

    return f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:8]}"


def network_worker_loop(worker_id: str | None = None) -> None:
    """公平调度来源扫描与下载，避免两个外部网络子进程并发。"""

    worker_id = worker_id or make_worker_id()
    last_kind = "source"
    while not stop_worker.wait(2):
        try:
            if lock_manager.locked("global"):
                continue
            settings = get_settings()
            advance_source_bulk_tasks(settings)
            source_due = has_due_source_scan()
            download_due = has_runnable_download_work(settings.retry_limit)
            next_kind = choose_network_work(source_due, download_due, last_kind)
            if next_kind is None:
                continue
            if next_kind == "source":
                process_next_source_history_scan(
                    settings,
                    worker_id=worker_id,
                    allow_during_downloads=True,
                )
            else:
                process_next_queued_run(settings, worker_id=worker_id)
            last_kind = next_kind
            advance_source_bulk_tasks(settings)
        except Exception:
            logger.exception("Network worker iteration failed.")


def choose_network_work(source_due: bool, download_due: bool, last_kind: str) -> str | None:
    """选择下一类外部网络工作；两类同时到期时严格交替。"""

    if source_due and download_due:
        return "download" if last_kind == "source" else "source"
    if source_due:
        return "source"
    if download_due:
        return "download"
    return None


app = create_app()
