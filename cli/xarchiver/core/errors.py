from __future__ import annotations

from enum import StrEnum


class ErrorCategory(StrEnum):
    AUTH_REQUIRED = "auth_required"
    COMMAND_NOT_FOUND = "command_not_found"
    DOWNLOAD_NO_OUTPUT = "download_no_output"
    FAILED = "failed"
    INTERRUPTED = "interrupted"
    INTERRUPTED_DOWNLOAD = "interrupted_download"
    INVALID_URL = "invalid_url"
    NETWORK_ERROR = "network_error"
    RATE_LIMITED = "rate_limited"
    UNSUPPORTED_MEDIA = "unsupported_media"
    UNKNOWN = "unknown"
    WORKER_ERROR = "worker_error"


PERMANENT_DOWNLOAD_CATEGORIES = {
    ErrorCategory.INVALID_URL,
    ErrorCategory.UNSUPPORTED_MEDIA,
}


class ArchiverError(Exception):
    def __init__(
        self,
        code: str,
        *,
        message: str | None = None,
        category: ErrorCategory | None = None,
        http_status: int = 400,
    ) -> None:
        super().__init__(message or code)
        self.code = code
        self.category = category
        self.http_status = http_status


def category_value(category: ErrorCategory | str | None) -> str | None:
    if category is None:
        return None
    if isinstance(category, ErrorCategory):
        return category.value
    return str(category)


def classify_x_error(stderr: str | None, *, no_output_hint: bool = True) -> ErrorCategory:
    text = (stderr or "").lower()
    if "cookies" in text and any(
        pattern in text for pattern in ("not found", "could not", "invalid", "empty")
    ):
        return ErrorCategory.AUTH_REQUIRED
    if any(
        pattern in text
        for pattern in ("login required", "sign in", "not logged in", "authentication", "auth")
    ):
        return ErrorCategory.AUTH_REQUIRED
    if "403" in text or "forbidden" in text or "unauthorized" in text:
        return ErrorCategory.AUTH_REQUIRED
    if "429" in text or "rate" in text:
        return ErrorCategory.RATE_LIMITED
    if any(
        pattern in text
        for pattern in ("timeout", "timed out", "connection", "network", "temporary failure")
    ):
        return ErrorCategory.NETWORK_ERROR
    if "404" in text or "not found" in text:
        return ErrorCategory.INVALID_URL
    if no_output_hint and "no results" in text:
        return ErrorCategory.DOWNLOAD_NO_OUTPUT
    if any(pattern in text for pattern in ("no video", "no media", "unsupported", "not supported")):
        return ErrorCategory.UNSUPPORTED_MEDIA
    return ErrorCategory.UNKNOWN
