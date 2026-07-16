from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock

from sqlalchemy import bindparam, func, select, update
from sqlalchemy.dialects.postgresql import insert

from xarchiver.config import Settings
from xarchiver.core.errors import (
    ArchiverError,
    ErrorCategory,
    category_value,
    classify_x_error,
)
from xarchiver.db import connect
from xarchiver.services.operation_logs import redact_sensitive_text
from xarchiver.sql_builder import compile_query
from xarchiver.tables import cookie_config

MAX_COOKIE_CONTENT_BYTES = 1024 * 1024
COOKIE_CHECK_URL = "https://x.com/i/bookmarks"
COOKIE_CONFIG_ID = 1
COOKIE_VALIDATION_STATUSES = {"unchecked", "valid", "invalid", "expired", "error"}
cookie_check_lock = Lock()


@dataclass(frozen=True)
class CookieContent:
    content: str
    source: str
    label: str | None = None
    updated_at: datetime | None = None


@dataclass(frozen=True)
class CookieInspection:
    content_sha256: str
    auth_token_expires_at: datetime | None


def normalize_cookie_content(content: str | None) -> str | None:
    if content is None:
        return None
    normalized = content.strip()
    return normalized or None


def normalize_label(label: str | None) -> str | None:
    if label is None:
        return None
    normalized = label.strip()
    return normalized or None


def inspect_cookie_content(
    content: str,
    *,
    now: datetime | None = None,
) -> CookieInspection:
    normalized = normalize_cookie_content(content)
    if normalized is None:
        raise cookie_error("cookie_empty")
    if len(normalized.encode("utf-8")) > MAX_COOKIE_CONTENT_BYTES:
        raise cookie_error("cookie_content_too_large")

    current = now or datetime.now(UTC)
    x_cookie_count = 0
    required: dict[str, tuple[str, int]] = {}

    for line_number, raw_line in enumerate(normalized.splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("#HttpOnly_"):
            line = line.removeprefix("#HttpOnly_")
        elif line.startswith("#"):
            continue

        parts = line.split("\t")
        if len(parts) != 7:
            raise cookie_error("cookie_netscape_format_invalid", f"line {line_number}")
        domain, _, _, _, expires_text, name, value = parts
        try:
            expires = int(expires_text)
        except ValueError as exc:
            raise cookie_error("cookie_expiration_invalid", f"line {line_number}") from exc
        if expires < 0:
            raise cookie_error("cookie_expiration_invalid", f"line {line_number}")

        normalized_domain = domain.lower().lstrip(".")
        if normalized_domain not in {"x.com", "twitter.com"}:
            continue
        x_cookie_count += 1
        if name in {"auth_token", "ct0"} and value:
            required[name] = (value, expires)

    if x_cookie_count == 0:
        raise cookie_error("cookie_x_domain_missing")
    for name in ("auth_token", "ct0"):
        if name not in required:
            raise cookie_error(f"cookie_{name}_missing")
        expires = required[name][1]
        if expires and expires <= int(current.timestamp()):
            raise cookie_error(f"cookie_{name}_expired")

    auth_expires = required["auth_token"][1]
    return CookieInspection(
        content_sha256=cookie_content_sha256(normalized),
        auth_token_expires_at=(
            datetime.fromtimestamp(auth_expires, tz=UTC) if auth_expires else None
        ),
    )


def get_cookie_config(settings: Settings | None = None) -> dict[str, object]:
    row = fetch_cookie_row()
    cookie = resolve_cookie_content(settings, row=row) if settings is not None else resolve_db_cookie(row)
    if cookie is None:
        return cookie_config_payload(None, row, local_error=None)

    try:
        inspection = inspect_cookie_content(cookie.content)
    except ArchiverError as exc:
        return cookie_config_payload(cookie, row, local_error=exc)
    return cookie_config_payload(cookie, row, inspection=inspection)


def save_cookie_content(content: str, label: str | None = None) -> dict[str, object]:
    normalized_content = normalize_cookie_content(content)
    if normalized_content is None:
        raise cookie_error("cookie_empty")
    inspection = inspect_cookie_content(normalized_content)
    normalized_label = normalize_label(label)
    statement = (
        insert(cookie_config)
        .values(
            id=bindparam("cookie_config_id", COOKIE_CONFIG_ID),
            content=bindparam("cookie_content", normalized_content),
            label=bindparam("cookie_label", normalized_label),
            updated_at=func.now(),
            validation_status="unchecked",
            validated_at=None,
            auth_token_expires_at=bindparam(
                "auth_token_expires_at",
                inspection.auth_token_expires_at,
            ),
            validation_error_category=None,
            validation_message="cookie_not_checked",
            validated_content_sha256=bindparam(
                "validated_content_sha256",
                inspection.content_sha256,
            ),
        )
        .on_conflict_do_update(
            index_elements=[cookie_config.c.id],
            set_={
                "content": bindparam("cookie_content", normalized_content),
                "label": bindparam("cookie_label", normalized_label),
                "updated_at": func.now(),
                "validation_status": "unchecked",
                "validated_at": None,
                "auth_token_expires_at": bindparam(
                    "auth_token_expires_at",
                    inspection.auth_token_expires_at,
                ),
                "validation_error_category": None,
                "validation_message": "cookie_not_checked",
                "validated_content_sha256": bindparam(
                    "validated_content_sha256",
                    inspection.content_sha256,
                ),
            },
        )
    )
    sql, params = compile_query(statement)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()
    return get_cookie_config()


def clear_cookie_content(settings: Settings | None = None) -> dict[str, object]:
    statement = (
        update(cookie_config)
        .where(cookie_config.c.id == bindparam("cookie_config_id", COOKIE_CONFIG_ID))
        .values(
            content=None,
            label=None,
            updated_at=func.now(),
            validation_status="unchecked",
            validated_at=None,
            auth_token_expires_at=None,
            validation_error_category=None,
            validation_message=None,
            validated_content_sha256=None,
        )
    )
    sql, params = compile_query(statement)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()
    return get_cookie_config(settings)


def check_cookie_config(settings: Settings) -> dict[str, object]:
    if not cookie_check_lock.acquire(blocking=False):
        raise ArchiverError(
            "cookie_check_in_progress",
            http_status=409,
        )
    try:
        cookie = resolve_cookie_content(settings)
        if cookie is None:
            raise cookie_error("cookie_missing", http_status=400)
        try:
            inspection = inspect_cookie_content(cookie.content)
        except ArchiverError as exc:
            inspection = CookieInspection(
                content_sha256=cookie_content_sha256(cookie.content),
                auth_token_expires_at=None,
            )
            expired = exc.code in {"cookie_auth_token_expired", "cookie_ct0_expired"}
            persist_cookie_validation(
                settings,
                inspection,
                status="expired" if expired else "invalid",
                error_category=ErrorCategory.AUTH_REQUIRED.value,
                message=exc.code,
            )
            return get_cookie_config(settings)
        status, category, message = run_cookie_check(settings, cookie.content)
        persist_cookie_validation(
            settings,
            inspection,
            status=status,
            error_category=category,
            message=message,
        )
        return get_cookie_config(settings)
    finally:
        cookie_check_lock.release()


def run_cookie_check(
    settings: Settings,
    content: str,
) -> tuple[str, str | None, str]:
    if shutil.which("gallery-dl") is None:
        return "error", ErrorCategory.COMMAND_NOT_FOUND.value, "cookie_check_command_not_found"

    state_dir = settings.archive_dir / "state"
    state_dir.mkdir(parents=True, exist_ok=True)
    file_descriptor, cookie_path_text = tempfile.mkstemp(
        prefix="cookie-check-",
        suffix=".txt",
        dir=state_dir,
        text=True,
    )
    cookie_path = Path(cookie_path_text)
    try:
        os.fchmod(file_descriptor, 0o600)
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as cookie_file:
            cookie_file.write(content if content.endswith("\n") else f"{content}\n")

        http_timeout = float(getattr(settings, "source_scan_http_timeout_seconds", 15.0))
        http_retries = int(getattr(settings, "source_scan_http_retries", 2))
        process_timeout = min(
            120.0,
            max(30.0, (http_retries + 1) * http_timeout + 15.0),
        )
        command = [
            "gallery-dl",
            "--config",
            "/app/gallery-dl.conf",
            "--dump-json",
            "--verbose",
            "--http-timeout",
            f"{http_timeout:g}",
            "--retries",
            str(http_retries),
            "-o",
            f"extractor.twitter.cookies={cookie_path}",
            "-o",
            "extractor.twitter.cookies-update=false",
            "-o",
            "extractor.twitter.ratelimit=abort",
            "-o",
            "limit=1",
            "--post-range",
            "1-1",
            COOKIE_CHECK_URL,
        ]
        try:
            result = subprocess.run(
                command,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                check=False,
                timeout=process_timeout,
            )
        except subprocess.TimeoutExpired:
            return "error", ErrorCategory.NETWORK_ERROR.value, "cookie_check_timeout"

        stderr = redact_sensitive_text(result.stderr or "")
        category = classify_cookie_check_error(stderr, result.returncode)
        if category == ErrorCategory.AUTH_REQUIRED.value:
            return "invalid", category, "cookie_check_auth_required"
        if category in {
            ErrorCategory.NETWORK_ERROR.value,
            ErrorCategory.RATE_LIMITED.value,
        }:
            return "error", category, f"cookie_check_{category}"
        if result.returncode != 0:
            return "error", category or ErrorCategory.UNKNOWN.value, "cookie_check_failed"
        return "valid", None, "cookie_check_valid"
    finally:
        cookie_path.unlink(missing_ok=True)


def classify_cookie_check_error(stderr: str, returncode: int) -> str | None:
    if returncode != 0:
        return category_value(classify_x_error(stderr, no_output_hint=False))

    terminal_lines: list[str] = []
    for line in stderr.splitlines():
        normalized = line.lower()
        exhausted_retry = re.search(r"\((\d+)/(\d+)\)\s*$", line)
        if "][error]" in normalized or (
            exhausted_retry is not None
            and exhausted_retry.group(1) == exhausted_retry.group(2)
        ):
            terminal_lines.append(line)
    if not terminal_lines:
        return None
    return category_value(
        classify_x_error("\n".join(terminal_lines), no_output_hint=False)
    )


def persist_cookie_validation(
    settings: Settings,
    inspection: CookieInspection,
    *,
    status: str,
    error_category: str | None,
    message: str,
) -> None:
    if status not in COOKIE_VALIDATION_STATUSES:
        raise ValueError(f"invalid_cookie_validation_status: {status}")
    lock_statement = (
        select(cookie_config.c.content)
        .where(cookie_config.c.id == bindparam("cookie_config_id", COOKIE_CONFIG_ID))
        .with_for_update()
    )
    lock_sql, lock_params = compile_query(lock_statement)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(lock_sql, lock_params)
            row = cur.fetchone()
            db_content = normalize_cookie_content(row["content"] if row else None)
            current_content = db_content or read_cookie_file(settings.cookie_file)
            if (
                current_content is None
                or cookie_content_sha256(current_content) != inspection.content_sha256
            ):
                raise ArchiverError("cookie_config_changed", http_status=409)

            statement = (
                update(cookie_config)
                .where(cookie_config.c.id == bindparam("cookie_config_id", COOKIE_CONFIG_ID))
                .values(
                    validation_status=status,
                    validated_at=func.now(),
                    auth_token_expires_at=inspection.auth_token_expires_at,
                    validation_error_category=error_category,
                    validation_message=message,
                    validated_content_sha256=inspection.content_sha256,
                )
            )
            sql, params = compile_query(statement)
            cur.execute(sql, params)
        conn.commit()


def resolve_cookie_content(
    settings: Settings,
    *,
    row: dict[str, object] | None = None,
) -> CookieContent | None:
    row = fetch_cookie_row() if row is None else row
    db_cookie = resolve_db_cookie(row)
    if db_cookie is not None:
        return db_cookie

    content = read_cookie_file(settings.cookie_file)
    if content is None:
        return None
    return CookieContent(content=content, source="file")


def resolve_db_cookie(row: dict[str, object] | None) -> CookieContent | None:
    db_content = normalize_cookie_content(row.get("content") if row else None)
    if db_content is None:
        return None
    return CookieContent(
        content=db_content,
        source="database",
        label=normalize_label(row.get("label") if row else None),
        updated_at=row.get("updated_at") if row else None,
    )


def fetch_cookie_row() -> dict[str, object] | None:
    statement = (
        select(
            cookie_config.c.content,
            cookie_config.c.label,
            cookie_config.c.updated_at,
            cookie_config.c.validation_status,
            cookie_config.c.validated_at,
            cookie_config.c.auth_token_expires_at,
            cookie_config.c.validation_error_category,
            cookie_config.c.validation_message,
            cookie_config.c.validated_content_sha256,
        )
        .where(cookie_config.c.id == bindparam("cookie_config_id", COOKIE_CONFIG_ID))
    )
    sql, params = compile_query(statement)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            return dict(row) if row else None


def cookie_config_payload(
    cookie: CookieContent | None,
    row: dict[str, object] | None,
    *,
    inspection: CookieInspection | None = None,
    local_error: ArchiverError | None = None,
) -> dict[str, object]:
    if cookie is None:
        return {
            "configured": False,
            "source": "none",
            "label": None,
            "updated_at": None,
            "validation_status": "unchecked",
            "validated_at": None,
            "auth_token_expires_at": None,
            "validation_error_category": None,
            "validation_message": None,
        }

    if local_error is not None:
        expired = local_error.code in {"cookie_auth_token_expired", "cookie_ct0_expired"}
        content_sha256 = cookie_content_sha256(cookie.content)
        matches = bool(
            row
            and row.get("validated_content_sha256") == content_sha256
            and row.get("validation_status") in {"invalid", "expired"}
        )
        return {
            "configured": True,
            "source": cookie.source,
            "label": cookie.label,
            "updated_at": cookie.updated_at,
            "validation_status": "expired" if expired else "invalid",
            "validated_at": row.get("validated_at") if matches else None,
            "auth_token_expires_at": None,
            "validation_error_category": (
                row.get("validation_error_category")
                if matches
                else ErrorCategory.AUTH_REQUIRED.value
            ),
            "validation_message": (
                row.get("validation_message") if matches else local_error.code
            ),
        }

    assert inspection is not None
    matches = bool(
        row
        and row.get("validated_content_sha256") == inspection.content_sha256
        and row.get("validation_status") in COOKIE_VALIDATION_STATUSES
    )
    return {
        "configured": True,
        "source": cookie.source,
        "label": cookie.label,
        "updated_at": cookie.updated_at,
        "validation_status": row.get("validation_status") if matches else "unchecked",
        "validated_at": row.get("validated_at") if matches else None,
        "auth_token_expires_at": inspection.auth_token_expires_at,
        "validation_error_category": (
            row.get("validation_error_category") if matches else None
        ),
        "validation_message": (
            row.get("validation_message") if matches else "cookie_not_checked"
        ),
    }


def cookie_content_sha256(content: str) -> str:
    normalized = normalize_cookie_content(content) or ""
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def read_cookie_file(path: Path) -> str | None:
    if not has_cookie_file(path):
        return None
    return normalize_cookie_content(path.read_text(encoding="utf-8"))


def has_cookie_file(path: Path) -> bool:
    return path.exists() and path.is_file() and path.stat().st_size > 0


def cookie_error(
    code: str,
    detail: str | None = None,
    *,
    http_status: int = 422,
) -> ArchiverError:
    message = f"{code}: {detail}" if detail else code
    return ArchiverError(
        code,
        message=message,
        category=ErrorCategory.AUTH_REQUIRED,
        http_status=http_status,
    )
