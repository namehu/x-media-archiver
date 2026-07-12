from __future__ import annotations

import json
import logging
import time
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4

import psycopg
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from xarchiver.config import get_settings
from xarchiver.services.auth import SESSION_COOKIE, authenticate_session

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)
LOCAL_DEV_ORIGINS = frozenset({"http://127.0.0.1:5173", "http://localhost:5173"})


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        settings = get_settings()
        request.state.auth_admin = None
        if settings.auth_mode == "disabled":
            return await call_next(request)

        path = request.url.path
        is_public = _is_public_path(path, request.method)
        is_protected = _is_protected_path(path) and not is_public
        token = request.cookies.get(SESSION_COOKIE)
        if token and (is_protected or path == "/api/v1/auth/session"):
            try:
                request.state.auth_admin = await run_in_threadpool(authenticate_session, token)
            except psycopg.Error:
                logging.getLogger("xarchiver.api.auth").exception(
                    "Authentication database lookup failed."
                )
                return _auth_error(503, "authentication_unavailable")

        if token and request.method in {"POST", "PUT", "PATCH", "DELETE"} and not _valid_origin(request):
            return _auth_error(403, "csrf_origin_invalid")
        if is_public:
            return await call_next(request)
        if is_protected and request.state.auth_admin is None:
            return _auth_error(401, "authentication_required")
        return await call_next(request)


def _is_public_path(path: str, method: str) -> bool:
    if path == "/health" or method == "OPTIONS":
        return True
    return path in {"/api/v1/auth/session", "/api/v1/auth/setup", "/api/v1/auth/login"}


def _is_protected_path(path: str) -> bool:
    return (
        path == "/api"
        or path.startswith("/api/")
        or path == "/openapi.json"
        or path.startswith("/docs")
        or path.startswith("/redoc")
    )


def _valid_origin(request: Request) -> bool:
    origin = request.headers.get("origin")
    if not origin:
        return False
    parsed = urlsplit(origin)
    if not parsed.scheme or not parsed.netloc:
        return False
    request_host = request.headers.get("host", "").lower()
    origin = f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"
    return parsed.netloc.lower() == request_host or origin in LOCAL_DEV_ORIGINS


def _auth_error(status_code: int, code: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"detail": code, "code": code, "message": code, "category": "auth"},
    )


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = getattr(record, "request_id", None)
        if request_id:
            payload["request_id"] = request_id
        for key in (
            "event",
            "method",
            "path",
            "status_code",
            "duration_ms",
            "client",
            "error_type",
            "details",
        ):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_api_logging() -> None:
    logging.getLogger("xarchiver").setLevel(logging.INFO)
    logging.getLogger("xarchiver.api.access").setLevel(logging.INFO)
    root = logging.getLogger()
    if not root.handlers:
        handler = logging.StreamHandler()
        root.addHandler(handler)
    for handler in root.handlers:
        handler.setFormatter(JsonLogFormatter())
        if not any(isinstance(filter_item, RequestIdFilter) for filter_item in handler.filters):
            handler.addFilter(RequestIdFilter())


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = request.headers.get("x-request-id") or uuid4().hex
        token = request_id_var.set(request_id)
        request.state.request_id = request_id
        start = time.perf_counter()
        try:
            try:
                response = await call_next(request)
            except Exception as exc:
                duration_ms = round((time.perf_counter() - start) * 1000, 2)
                logging.getLogger("xarchiver.api.access").exception(
                    "API request failed.",
                    extra={
                        "event": "api.request.failed",
                        "method": request.method,
                        "path": request.url.path,
                        "duration_ms": duration_ms,
                        "client": request.client.host if request.client else None,
                        "error_type": type(exc).__name__,
                    },
                )
                raise

            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            response.headers["X-Request-ID"] = request_id
            logging.getLogger("xarchiver.api.access").info(
                "API request completed.",
                extra={
                    "event": "api.request.completed",
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": response.status_code,
                    "duration_ms": duration_ms,
                    "client": request.client.host if request.client else None,
                },
            )
            return response
        finally:
            request_id_var.reset(token)
