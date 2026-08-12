"""媒体库相关路由。

面向 WebUI 提供媒体库概览、媒体列表、推文详情、失败记录、重复项以及
物理删除媒体等接口。
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date

from fastapi import APIRouter, HTTPException, Query

from xarchiver.api.deps import execute_write_action, raise_api_error
from xarchiver.api.schemas import (
    AuthorOptionsResponse,
    BulkOrganizationRequest,
    CollectionWriteRequest,
    DuplicatesPageResponse,
    FailureActionsResponse,
    FailureIgnoreRequest,
    FailurePageResponse,
    FailureSelectionRequest,
    MediaDeleteRequest,
    MediaPageResponse,
    OrganizationCatalogResponse,
    OrganizationCollectionPageResponse,
    OrganizationDeleteRequest,
    PostFeedPageResponse,
    SummaryResponse,
    TagWriteRequest,
    TweetDetailResponse,
    TweetLabelsRequest,
    TweetNoteRequest,
    TweetOrganizationResponse,
    TweetSearchOptionsResponse,
    TweetSearchPageResponse,
    WriteActionResponse,
)
from xarchiver.config import get_settings
from xarchiver.core.errors import ArchiverError
from xarchiver.services.failures import (
    FAILURE_STATUSES,
    ignore_failures,
    list_failure_actions,
    list_failures,
    restore_failures,
    retry_failures,
)
from xarchiver.services.library import (
    get_author_options,
    get_summary,
    get_tweet_detail,
    get_tweet_search_options,
    list_collection_tweets_page,
    list_duplicates_page,
    list_media_page,
    list_organization_catalog_page,
    list_posts_page,
    search_tweets_page,
)
from xarchiver.services.media_deletion import delete_media_assets
from xarchiver.services.organization import (
    bulk_update_labels,
    create_collection,
    create_tag,
    delete_collection,
    delete_tag,
    get_tweet_organization,
    replace_tweet_labels,
    save_tweet_note,
    update_collection,
    update_tag,
)

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


@router.get("/search", response_model=TweetSearchPageResponse)
def search_tweets(
    q: str | None = Query(None, max_length=500),
    source_id: int | None = Query(None, ge=1),
    date_from: date | None = None,
    date_to: date | None = None,
    media_type: str | None = Query(None, pattern="^(photo|video)$"),
    tweet_status: str | None = Query(
        "verified",
        pattern=(
            "^(all|pending|downloading|downloaded|partial|failed_retryable|"
            "failed_permanent|verified|missing|corrupt|skipped)$"
        ),
    ),
    tag_id: int | None = Query(None, ge=1),
    collection_id: int | None = Query(None, ge=1),
    sort: str = Query("auto", pattern="^(auto|relevance|newest|oldest)$"),
    client_utc_offset_minutes: int = Query(0, ge=-840, le=840),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
) -> dict[str, object]:
    """执行 Tweet 级中英文全文与模糊搜索。"""

    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=400, detail="invalid_search_date_range")
    return search_tweets_page(
        get_settings(),
        query=q,
        source_id=source_id,
        date_from=date_from,
        date_to=date_to,
        media_type=media_type,
        tweet_status=tweet_status,
        tag_id=tag_id,
        collection_id=collection_id,
        sort=sort,
        client_utc_offset_minutes=client_utc_offset_minutes,
        limit=limit,
        offset=offset,
    )


@router.get("/search/options", response_model=TweetSearchOptionsResponse)
def search_options() -> dict[str, object]:
    """返回全局搜索页面使用的标签和合集筛选项。"""

    return get_tweet_search_options()


@router.get("/organization", response_model=OrganizationCatalogResponse)
def organization_catalog() -> dict[str, object]:
    """返回标签与合集管理目录。"""

    return list_organization_catalog_page(get_settings())


@router.post("/organization/tags", response_model=WriteActionResponse)
def add_tag(request: TagWriteRequest) -> dict[str, object]:
    """创建平面标签。"""

    return _organization_write(
        "create-tag",
        lambda: create_tag(request.name, request.color, request.description),
    )


@router.put("/organization/tags/{tag_id}", response_model=WriteActionResponse)
def edit_tag(tag_id: int, request: TagWriteRequest) -> dict[str, object]:
    """更新标签元数据。"""

    return _organization_write(
        "update-tag",
        lambda: update_tag(tag_id, request.name, request.color, request.description),
    )


@router.delete("/organization/tags/{tag_id}", response_model=WriteActionResponse)
def remove_tag(tag_id: int, request: OrganizationDeleteRequest) -> dict[str, object]:
    """解除标签关联并删除标签本身。"""

    return _organization_write(
        "delete-tag",
        lambda: delete_tag(tag_id, confirmed=request.confirm_delete),
    )


@router.post("/organization/collections", response_model=WriteActionResponse)
def add_collection(request: CollectionWriteRequest) -> dict[str, object]:
    """创建手工合集。"""

    return _organization_write(
        "create-collection",
        lambda: create_collection(request.name, request.description),
    )


@router.put("/organization/collections/{collection_id}", response_model=WriteActionResponse)
def edit_collection(collection_id: int, request: CollectionWriteRequest) -> dict[str, object]:
    """更新合集元数据与封面。"""

    return _organization_write(
        "update-collection",
        lambda: update_collection(
            collection_id,
            request.name,
            request.description,
            request.cover_media_id,
        ),
    )


@router.delete("/organization/collections/{collection_id}", response_model=WriteActionResponse)
def remove_collection(collection_id: int, request: OrganizationDeleteRequest) -> dict[str, object]:
    """解除合集成员关系并删除合集本身。"""

    return _organization_write(
        "delete-collection",
        lambda: delete_collection(collection_id, confirmed=request.confirm_delete),
    )


@router.get(
    "/organization/collections/{collection_id}/tweets",
    response_model=OrganizationCollectionPageResponse,
)
def collection_tweets_page(
    collection_id: int,
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
) -> dict[str, object]:
    """返回合集内的 Tweet 级帖子流。"""

    try:
        return list_collection_tweets_page(
            get_settings(),
            collection_id,
            limit=limit,
            offset=offset,
        )
    except ValueError as exc:
        raise_api_error(exc, default_status=404)


@router.get("/tweets/{tweet_id}/organization", response_model=TweetOrganizationResponse)
def tweet_organization(tweet_id: str) -> dict[str, object]:
    """返回单条 Tweet 的标签、合集和私人备注。"""

    result = get_tweet_organization(tweet_id)
    if result is None:
        raise HTTPException(status_code=404, detail="tweet_not_found")
    return result


@router.put("/tweets/{tweet_id}/organization/labels", response_model=WriteActionResponse)
def update_tweet_labels(tweet_id: str, request: TweetLabelsRequest) -> dict[str, object]:
    """替换单条 Tweet 的标签与合集集合。"""

    return _organization_write(
        "update-tweet-labels",
        lambda: replace_tweet_labels(tweet_id, request.tag_ids, request.collection_ids),
    )


@router.put("/tweets/{tweet_id}/organization/note", response_model=WriteActionResponse)
def update_tweet_note(tweet_id: str, request: TweetNoteRequest) -> dict[str, object]:
    """保存单条纯文本私人备注。"""

    return _organization_write(
        "update-tweet-note",
        lambda: save_tweet_note(tweet_id, request.content),
    )


@router.post("/organization/bulk", response_model=WriteActionResponse)
def bulk_organize(request: BulkOrganizationRequest) -> dict[str, object]:
    """对最多 200 条 Tweet 批量加减标签与合集。"""

    return _organization_write(
        "bulk-organize-tweets",
        lambda: bulk_update_labels(
            request.tweet_ids,
            add_tag_ids=request.add_tag_ids,
            remove_tag_ids=request.remove_tag_ids,
            add_collection_ids=request.add_collection_ids,
            remove_collection_ids=request.remove_collection_ids,
        ),
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
    disposition: str = Query("open", pattern="^(open|ignored|all)$"),
    status: list[str] | None = Query(None),
    error_category: str | None = Query(None, max_length=200),
    search: str | None = Query(None, max_length=200),
    sort: str = Query("recent", pattern="^(recent|oldest|retries)$"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, object]:
    """分页返回失败记录列表。"""

    if status and any(value not in FAILURE_STATUSES for value in status):
        raise HTTPException(status_code=400, detail="invalid_failure_status")
    return list_failures(
        limit=limit,
        offset=offset,
        disposition=disposition,
        statuses=status,
        error_category=error_category,
        search=search,
        sort=sort,
    )


@router.get("/failures/{tweet_id}/actions", response_model=FailureActionsResponse)
def failure_actions(tweet_id: str, limit: int = Query(100, ge=1, le=200)) -> dict[str, object]:
    """返回单条 Tweet 的失败处置时间线。"""

    return list_failure_actions(tweet_id, limit=limit)


@router.post("/failures/ignore", response_model=WriteActionResponse)
def ignore_failure_items(request: FailureIgnoreRequest) -> dict[str, object]:
    """忽略精确选择的失败项，并停止尚未完成的自动重试。"""

    try:
        return execute_write_action(
            "ignore-failures",
            lambda: ignore_failures(request.tweet_ids, request.reason, request.note),
        )
    except (ArchiverError, ValueError) as exc:
        raise_api_error(exc)


@router.post("/failures/restore", response_model=WriteActionResponse)
def restore_failure_items(request: FailureSelectionRequest) -> dict[str, object]:
    """把已忽略失败项恢复到待处理工作台。"""

    try:
        return execute_write_action(
            "restore-failures",
            lambda: restore_failures(request.tweet_ids),
        )
    except (ArchiverError, ValueError) as exc:
        raise_api_error(exc)


@router.post("/failures/retry", response_model=WriteActionResponse)
def retry_failure_items(request: FailureSelectionRequest) -> dict[str, object]:
    """为精确选择的失败项创建一次立即执行的手动重试运行。"""

    try:
        return execute_write_action(
            "retry-failures",
            lambda: retry_failures(request.tweet_ids),
        )
    except (ArchiverError, ValueError) as exc:
        raise_api_error(exc)


@router.get("/duplicates", response_model=DuplicatesPageResponse)
def duplicates(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict[str, object]:
    """分页返回重复媒体分组。"""

    return list_duplicates_page(get_settings(), limit=limit, offset=offset)


def _organization_write(
    name: str,
    action: Callable[[], dict[str, object]],
) -> dict[str, object]:
    """在 library 细粒度写锁下执行整理写操作。"""

    try:
        return execute_write_action(name, action, scope="library-organization")
    except (ArchiverError, ValueError) as exc:
        raise_api_error(exc)
