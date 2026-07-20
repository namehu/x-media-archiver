"""配置相关路由。

当前主要负责 cookie 配置的读取、更新、主动校验和清理。
"""

from __future__ import annotations

from fastapi import APIRouter

from xarchiver.api.schemas import CookieConfigResponse, UpdateCookiesRequest
from xarchiver.config import get_settings
from xarchiver.services.cookies import (
    check_cookie_config,
    clear_cookie_content,
    get_cookie_config,
    save_cookie_content,
)

router = APIRouter(tags=["settings"])


@router.get("/settings/cookies", response_model=CookieConfigResponse)
def cookies_config() -> dict[str, object]:
    """读取当前 cookie 配置及校验状态。"""

    return get_cookie_config(get_settings())


@router.post("/settings/cookies", response_model=CookieConfigResponse)
def update_cookies_config(request: UpdateCookiesRequest) -> dict[str, object]:
    """更新数据库中的 cookie 内容与标签。"""

    save_cookie_content(request.content, request.label)
    return get_cookie_config(get_settings())


@router.post("/settings/cookies/check", response_model=CookieConfigResponse)
def check_cookies_config() -> dict[str, object]:
    """主动检查当前 cookie 是否仍然可用。"""

    return check_cookie_config(get_settings())


@router.delete("/settings/cookies", response_model=CookieConfigResponse)
def delete_cookies_config() -> dict[str, object]:
    """清空当前保存的 cookie 配置。"""

    return clear_cookie_content(get_settings())
