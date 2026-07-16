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
    return get_cookie_config(get_settings())


@router.post("/settings/cookies", response_model=CookieConfigResponse)
def update_cookies_config(request: UpdateCookiesRequest) -> dict[str, object]:
    save_cookie_content(request.content, request.label)
    return get_cookie_config(get_settings())


@router.post("/settings/cookies/check", response_model=CookieConfigResponse)
def check_cookies_config() -> dict[str, object]:
    return check_cookie_config(get_settings())


@router.delete("/settings/cookies", response_model=CookieConfigResponse)
def delete_cookies_config() -> dict[str, object]:
    return clear_cookie_content(get_settings())
