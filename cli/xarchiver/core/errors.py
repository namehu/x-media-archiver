"""核心错误类型与错误分类辅助函数。"""

from __future__ import annotations

from enum import StrEnum


class ErrorCategory(StrEnum):
    """应用内统一使用的错误类别枚举。"""

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
    """带错误码、类别和 HTTP 状态的业务异常。"""

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


ERROR_HTTP_STATUS_BY_CODE = {
    "archive_run_has_no_failed_items": 409,
    "archive_run_not_found": 404,
    "source_has_no_unsubmitted_tweets": 409,
    "source_not_found": 404,
    "source_paused": 409,
    "write_action_in_progress": 409,
    "media_delete_active_work": 409,
    "media_delete_operation_in_progress": 409,
    "media_assets_not_found": 404,
}


ERROR_CATEGORY_VALUES = {category.value for category in ErrorCategory}


def category_value(category: ErrorCategory | str | None) -> str | None:
    """把错误类别统一转换成可序列化的字符串值。"""

    if category is None:
        return None
    if isinstance(category, ErrorCategory):
        return category.value
    return str(category)


def error_response_payload(
    code: str,
    *,
    message: str | None = None,
    category: ErrorCategory | str | None = None,
) -> dict[str, str | None]:
    """构造 API 层统一使用的错误响应载荷。"""

    category_text = category_value(category)
    if category_text is None and code in ERROR_CATEGORY_VALUES:
        category_text = code
    return {
        "detail": code,
        "code": code,
        "message": message or code,
        "category": category_text,
    }


def http_status_for_error_code(code: str, default: int = 400) -> int:
    """按错误码返回约定的 HTTP 状态码。"""

    return ERROR_HTTP_STATUS_BY_CODE.get(code, default)


def classify_x_error(stderr: str | None, *, no_output_hint: bool = True) -> ErrorCategory:
    """根据 X 相关工具输出粗略归类错误类型。"""

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
        for pattern in (
            "timeout",
            "timed out",
            "connection refused",
            "connection reset",
            "connection aborted",
            "connection error",
            "failed to establish a new connection",
            "name resolution",
            "network",
            "temporary failure",
            "sslerror",
            "unexpected_eof",
            "eof occurred",
        )
    ):
        return ErrorCategory.NETWORK_ERROR
    if "404" in text or "not found" in text:
        return ErrorCategory.INVALID_URL
    if no_output_hint and "no results" in text:
        return ErrorCategory.DOWNLOAD_NO_OUTPUT
    if any(pattern in text for pattern in ("no video", "no media", "unsupported", "not supported")):
        return ErrorCategory.UNSUPPORTED_MEDIA
    return ErrorCategory.UNKNOWN
