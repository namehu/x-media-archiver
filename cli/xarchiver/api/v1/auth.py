"""认证与会话路由。

负责初始化管理员、登录登出、会话查询，以及密码修改等认证相关入口。
"""

from __future__ import annotations

import time
from collections import defaultdict
from threading import Lock

import psycopg
from fastapi import APIRouter, HTTPException, Request, Response, status

from xarchiver.api.schemas.requests import (
    AuthLoginRequest,
    AuthPasswordRequest,
    AuthPreferencesRequest,
    AuthSetupRequest,
)
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
    update_media_privacy_mode,
)

router = APIRouter(prefix="/auth", tags=["auth"])
_failed_logins: dict[str, list[float]] = defaultdict(list)
_failed_login_lock = Lock()
_FAILURE_WINDOW_SECONDS = 15 * 60
_MAX_FAILURES = 5
_MAX_TRACKED_CLIENTS = 2048


@router.get("/session", response_model=AuthSessionResponse)
def session(request: Request) -> dict[str, object]:
    """返回当前请求对应的认证会话状态。"""

    settings = get_settings()
    if settings.auth_mode == "disabled":
        return _authenticated_response(
            {
                "username": "local",
                "media_privacy_mode": False,
            },
            auth_mode="disabled",
        )
    current = getattr(request.state, "auth_admin", None)
    if current is not None:
        return _authenticated_response(current)
    if _db_call(get_admin) is None:
        return {
            "status": "uninitialized",
            "auth_mode": "password",
            "user": None,
        }
    return {
        "status": "anonymous",
        "auth_mode": "password",
        "user": None,
    }


@router.post("/setup", response_model=AuthSessionResponse)
def setup(request: Request, response: Response, payload: AuthSetupRequest) -> dict[str, object]:
    """使用一次性 setup token 初始化管理员账号。"""

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
    _set_session_cookie(request, response, _db_call(create_session))
    return _authenticated_response(admin)


@router.post("/login", response_model=AuthSessionResponse)
def login(request: Request, response: Response, payload: AuthLoginRequest) -> dict[str, object]:
    """执行管理员登录，并在成功后写入会话 Cookie。"""

    key = _login_key(request)
    if _is_rate_limited(key):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="login_rate_limited")
    authenticated = _db_call(create_login_session, payload.username, payload.password)
    if authenticated is None:
        _record_failure(key)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_credentials")
    admin, token = authenticated
    _clear_failures(key)
    _set_session_cookie(request, response, token)
    return _authenticated_response(admin)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response) -> None:
    """注销当前会话，并删除浏览器端 Cookie。"""

    token = request.cookies.get(SESSION_COOKIE)
    if token:
        _db_call(revoke_session, token)
    response.delete_cookie(
        SESSION_COOKIE,
        path="/",
        secure=_session_cookie_secure(request),
        samesite="strict",
    )


@router.post("/password", response_model=AuthSessionResponse)
def update_password(
    request: Request,
    response: Response,
    payload: AuthPasswordRequest,
) -> dict[str, object]:
    """校验旧密码后更新管理员密码。"""

    try:
        _db_call(change_password, payload.current_password, payload.new_password)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_credentials") from exc
    _set_session_cookie(request, response, _db_call(create_session))
    admin = _db_call(get_admin)
    return _authenticated_response(
        {
            "username": admin.username,
            "media_privacy_mode": admin.media_privacy_mode,
        }
    )


@router.patch("/preferences", response_model=AuthSessionResponse)
def update_preferences(
    request: Request,
    payload: AuthPreferencesRequest,
) -> dict[str, object]:
    """更新当前管理员的媒体隐私偏好。"""

    if get_settings().auth_mode == "disabled":
        return _authenticated_response(
            {
                "username": "local",
                "media_privacy_mode": payload.media_privacy_mode,
            },
            auth_mode="disabled",
        )
    token = request.cookies.get(SESSION_COOKIE)
    try:
        current = _db_call(update_media_privacy_mode, token, payload.media_privacy_mode)
    except AuthError as exc:
        code = str(exc)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=code) from exc
    return _authenticated_response(current)


def _authenticated_response(
    current: dict[str, object],
    *,
    auth_mode: str = "password",
) -> dict[str, object]:
    """统一构造不暴露内部账号 ID 的认证响应。"""

    return {
        "status": "authenticated",
        "auth_mode": auth_mode,
        "user": {
            "username": str(current["username"]),
            "media_privacy_mode": bool(current.get("media_privacy_mode", False)),
        },
    }


def _set_session_cookie(request: Request, response: Response, token: str) -> None:
    """把认证会话写入浏览器 Cookie。"""

    settings = get_settings()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.auth_session_ttl_hours * 60 * 60,
        httponly=True,
        secure=_session_cookie_secure(request),
        samesite="strict",
        path="/",
    )


def _session_cookie_secure(request: Request) -> bool:
    """按配置与可信代理解析后的请求协议决定 Cookie Secure 标记。"""

    policy = get_settings().auth_cookie_secure
    if policy == "true":
        return True
    if policy == "false":
        return False
    return request.url.scheme == "https"


def _db_call(function, *args, **kwargs):
    """包装数据库调用，把数据库不可用转换成统一 HTTP 错误。"""

    try:
        return function(*args, **kwargs)
    except psycopg.Error as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="authentication_unavailable",
        ) from exc


def _login_key(request: Request) -> str:
    """提取登录限流使用的客户端标识。"""

    client = request.client.host if request.client else "unknown"
    return client


def _active_failures(key: str) -> list[float]:
    """返回限流时间窗内仍然有效的失败记录。"""

    cutoff = time.monotonic() - _FAILURE_WINDOW_SECONDS
    return [value for value in _failed_logins.get(key, []) if value >= cutoff]


def _is_rate_limited(key: str) -> bool:
    """判断某个客户端是否已达到登录失败限流阈值。"""

    with _failed_login_lock:
        active = _active_failures(key)
        if active:
            _failed_logins[key] = active
        else:
            _failed_logins.pop(key, None)
        return len(active) >= _MAX_FAILURES


def _record_failure(key: str) -> None:
    """记录一次登录失败，并顺带清理过期失败条目。"""

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
    """清空某个客户端累计的登录失败记录。"""

    with _failed_login_lock:
        _failed_logins.pop(key, None)
