from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from xarchiver.config import get_settings
from xarchiver.services.failures import list_failures
from xarchiver.services.library import get_summary, get_tweet_detail, list_duplicates, list_media
from xarchiver.services.runs import (
    run_archive_urls,
    run_export_duplicates,
    run_export_failures,
    run_export_media,
    run_recover_interrupted,
    run_requeue,
    run_verify,
)

write_action_lock = Lock()


class VerifyRequest(BaseModel):
    limit: int | None = Field(default=None, ge=1)


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


def create_app() -> FastAPI:
    app = FastAPI(title="x-media-archiver local API", version="0.2.0")
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

    @app.post("/api/runs/archive-urls")
    def archive_urls_run(request: ArchiveUrlsRequest) -> dict[str, object]:
        settings = get_settings()
        input_path = Path(request.path)
        if not input_path.exists() or not input_path.is_file():
            raise HTTPException(status_code=404, detail="input_file_not_found")
        return execute_write_action("archive-urls", lambda: run_archive_urls(input_path, settings, request.limit))

    return app


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


def resolve_archive_file(archive_dir: Path, relative_path: str) -> Path:
    base = archive_dir.resolve()
    target = (base / relative_path).resolve()
    if base != target and base not in target.parents:
        raise HTTPException(status_code=400, detail="invalid_media_path")
    return target


app = create_app()
