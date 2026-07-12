from __future__ import annotations

import time
from collections import defaultdict
from threading import Lock

import psycopg
from fastapi import APIRouter, HTTPException, Request, Response, status

from xarchiver.api.schemas.requests import AuthLoginRequest, AuthPasswordRequest, AuthSetupRequest
from xarchiver.api.schemas.responses import AuthSessionResponse
from xarchiver.config import get_settings
from xarchiver.services.auth import (
    SESSION_COOKIE,
    AuthError,
    change_password,
    create_admin,
    create_login_session,
    create_session,
    get_admin,
    revoke_session,
)

router = APIRouter(prefix="/auth", tags=["auth"])
_failed_logins: dict[str, list[float]] = defaultdict(list)
_failed_login_lock = Lock()
_FAILURE_WINDOW_SECONDS = 15 * 60
_MAX_FAILURES = 5
_MAX_TRACKED_CLIENTS = 2048


@router.get("/session", response_model=AuthSessionResponse)
def session(request: Request) -> dict[str, object]:
    settings = get_settings()
    if settings.auth_mode == "disabled":
        return {"status": "authenticated", "auth_mode": "disabled", "user": {"username": "local"}}
    current = getattr(request.state, "auth_admin", None)
    if current is not None:
        return {"status": "authenticated", "auth_mode": "password", "user": current}
    if _db_call(get_admin) is None:
        return {"status": "uninitialized", "auth_mode": "password", "user": None}
    return {"status": "anonymous", "auth_mode": "password", "user": None}


@router.post("/setup", response_model=AuthSessionResponse)
def setup(response: Response, payload: AuthSetupRequest) -> dict[str, object]:
    if _db_call(get_admin) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="admin_already_initialized")
    try:
        admin = _db_call(create_admin, payload.setup_token, payload.username, payload.password)
    except AuthError as exc:
        code = str(exc)
        status_code = status.HTTP_401_UNAUTHORIZED if code == "invalid_setup_token" else status.HTTP_400_BAD_REQUEST
        if code == "admin_already_initialized":
            status_code = status.HTTP_409_CONFLICT
        raise HTTPException(status_code=status_code, detail=code) from exc
    _set_session_cookie(response, _db_call(create_session))
    return {"status": "authenticated", "auth_mode": "password", "user": admin}


@router.post("/login", response_model=AuthSessionResponse)
def login(request: Request, response: Response, payload: AuthLoginRequest) -> dict[str, object]:
    key = _login_key(request)
    if _is_rate_limited(key):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="login_rate_limited")
    authenticated = _db_call(create_login_session, payload.username, payload.password)
    if authenticated is None:
        _record_failure(key)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_credentials")
    admin, token = authenticated
    _clear_failures(key)
    _set_session_cookie(response, token)
    return {"status": "authenticated", "auth_mode": "password", "user": admin}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        _db_call(revoke_session, token)
    response.delete_cookie(
        SESSION_COOKIE,
        path="/",
        secure=get_settings().auth_cookie_secure,
        samesite="strict",
    )


@router.post("/password", response_model=AuthSessionResponse)
def update_password(response: Response, payload: AuthPasswordRequest) -> dict[str, object]:
    try:
        _db_call(change_password, payload.current_password, payload.new_password)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_credentials") from exc
    _set_session_cookie(response, _db_call(create_session))
    admin = _db_call(get_admin)
    return {"status": "authenticated", "auth_mode": "password", "user": {"username": admin.username}}


def _set_session_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.auth_session_ttl_hours * 60 * 60,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="strict",
        path="/",
    )


def _db_call(function, *args):
    try:
        return function(*args)
    except psycopg.Error as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="authentication_unavailable",
        ) from exc


def _login_key(request: Request) -> str:
    client = request.client.host if request.client else "unknown"
    return client


def _active_failures(key: str) -> list[float]:
    cutoff = time.monotonic() - _FAILURE_WINDOW_SECONDS
    return [value for value in _failed_logins.get(key, []) if value >= cutoff]


def _is_rate_limited(key: str) -> bool:
    with _failed_login_lock:
        active = _active_failures(key)
        if active:
            _failed_logins[key] = active
        else:
            _failed_logins.pop(key, None)
        return len(active) >= _MAX_FAILURES


def _record_failure(key: str) -> None:
    with _failed_login_lock:
        now = time.monotonic()
        cutoff = now - _FAILURE_WINDOW_SECONDS
        for candidate, failures in list(_failed_logins.items()):
            active = [value for value in failures if value >= cutoff]
            if active:
                _failed_logins[candidate] = active
            else:
                _failed_logins.pop(candidate, None)
        if key not in _failed_logins and len(_failed_logins) >= _MAX_TRACKED_CLIENTS:
            oldest_key = min(
                _failed_logins,
                key=lambda candidate: max(_failed_logins[candidate], default=0),
            )
            _failed_logins.pop(oldest_key, None)
        _failed_logins[key] = [*_failed_logins.get(key, []), now]


def _clear_failures(key: str) -> None:
    with _failed_login_lock:
        _failed_logins.pop(key, None)
