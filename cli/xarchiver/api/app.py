from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from xarchiver.config import get_settings
from xarchiver.services.failures import list_failures
from xarchiver.services.library import get_summary, get_tweet_detail, list_duplicates, list_media


def create_app() -> FastAPI:
    app = FastAPI(title="x-media-archiver local API", version="0.2.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ],
        allow_credentials=False,
        allow_methods=["GET"],
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

    return app


def resolve_archive_file(archive_dir: Path, relative_path: str) -> Path:
    base = archive_dir.resolve()
    target = (base / relative_path).resolve()
    if base != target and base not in target.parents:
        raise HTTPException(status_code=400, detail="invalid_media_path")
    return target


app = create_app()
