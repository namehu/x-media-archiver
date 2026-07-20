from __future__ import annotations

"""媒体库相关路由。

面向 WebUI 提供媒体库概览、媒体列表、推文详情、失败记录、重复项以及
物理删除媒体等接口。
"""

from fastapi import APIRouter, HTTPException, Query

from xarchiver.api.deps import execute_write_action, raise_api_error
from xarchiver.api.schemas import (
    AuthorOptionsResponse,
    DuplicatesPageResponse,
    FailurePageResponse,
    MediaDeleteRequest,
    MediaPageResponse,
    PostFeedPageResponse,
    SummaryResponse,
    TweetDetailResponse,
    WriteActionResponse,
)
from xarchiver.config import get_settings
from xarchiver.core.errors import ArchiverError
from xarchiver.services.failures import list_failures
from xarchiver.services.library import (
    get_author_options,
    get_summary,
    get_tweet_detail,
    list_duplicates_page,
    list_media_page,
    list_posts_page,
)
from xarchiver.services.media_deletion import delete_media_assets

router = APIRouter(prefix="/library", tags=["library"])


@router.get("/summary", response_model=SummaryResponse)
def summary() -> dict[str, object]:
    """返回媒体库首页摘要数据。"""

    return get_summary(get_settings())


@router.get("/media", response_model=MediaPageResponse)
def media(
    author: str | None = None,
    author_username: str | None = None,
    text: str | None = None,
    tweet_status: str | None = None,
    media_status: str | None = Query("verified"),
    media_type: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, object]:
    """按筛选条件分页查询媒体列表。"""

    return list_media_page(
        get_settings(),
        author=author,
        author_username=author_username,
        text=text,
        tweet_status=tweet_status,
        media_status=media_status,
        media_type=media_type,
        limit=limit,
        offset=offset,
    )


@router.get("/authors", response_model=AuthorOptionsResponse)
def authors(
    q: str | None = Query(None, max_length=100),
    limit: int = Query(20, ge=1, le=50),
) -> dict[str, object]:
    """返回作者筛选下拉使用的候选列表。"""

    return get_author_options(query=q, limit=limit)


@router.get("/posts", response_model=PostFeedPageResponse)
def posts(
    source_id: int | None = Query(None, ge=1),
    source_type: str | None = Query(
        None,
        pattern="^(profile|user_media|likes|bookmarks|search|manual)$",
    ),
    author_username: str | None = Query(None, max_length=100),
    text: str | None = Query(None, max_length=500),
    media_type: str | None = Query(None, pattern="^(photo|video)$"),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
) -> dict[str, object]:
    """按来源、作者和媒体类型等条件分页查询帖子流。"""

    return list_posts_page(
        get_settings(),
        source_id=source_id,
        source_type=source_type,
        author_username=author_username,
        text=text,
        media_type=media_type,
        limit=limit,
        offset=offset,
    )


@router.delete("/media", response_model=WriteActionResponse)
def delete_media(request: MediaDeleteRequest) -> dict[str, object]:
    """按媒体 ID 执行受确认保护的物理删除。"""

    if not request.confirm_physical_delete:
        raise HTTPException(status_code=400, detail="physical_delete_confirmation_required")
    settings = get_settings()
    try:
        return execute_write_action(
            "delete-library-media",
            lambda: delete_media_assets(settings, request.operation_id, request.media_ids),
        )
    except (ArchiverError, ValueError) as exc:
        raise_api_error(exc)


@router.get("/tweets/{tweet_id}", response_model=TweetDetailResponse)
def tweet_detail(tweet_id: str) -> dict[str, object]:
    """查询单条推文的详情、媒体和下载尝试记录。"""

    detail = get_tweet_detail(get_settings(), tweet_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="tweet_not_found")
    return detail


@router.get("/failures", response_model=FailurePageResponse)
def failures(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, object]:
    """分页返回失败记录列表。"""

    return list_failures(limit=limit, offset=offset)


@router.get("/duplicates", response_model=DuplicatesPageResponse)
def duplicates(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict[str, object]:
    """分页返回重复媒体分组。"""

    return list_duplicates_page(get_settings(), limit=limit, offset=offset)
