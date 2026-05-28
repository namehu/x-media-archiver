from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from xarchiver.api.schemas import (
    DuplicatesPageResponse,
    FailurePageResponse,
    MediaPageResponse,
    SummaryResponse,
    TweetDetailResponse,
)
from xarchiver.config import get_settings
from xarchiver.services.failures import list_failures
from xarchiver.services.library import get_summary, get_tweet_detail, list_duplicates_page, list_media_page

router = APIRouter(prefix="/library", tags=["library"])


@router.get("/summary", response_model=SummaryResponse)
def summary() -> dict[str, object]:
    return get_summary(get_settings())


@router.get("/media", response_model=MediaPageResponse)
def media(
    author: str | None = None,
    text: str | None = None,
    tweet_status: str | None = None,
    media_status: str | None = Query("verified"),
    media_type: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, object]:
    return list_media_page(
        get_settings(),
        author=author,
        text=text,
        tweet_status=tweet_status,
        media_status=media_status,
        media_type=media_type,
        limit=limit,
        offset=offset,
    )


@router.get("/tweets/{tweet_id}", response_model=TweetDetailResponse)
def tweet_detail(tweet_id: str) -> dict[str, object]:
    detail = get_tweet_detail(get_settings(), tweet_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="tweet_not_found")
    return detail


@router.get("/failures", response_model=FailurePageResponse)
def failures(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, object]:
    return list_failures(limit=limit, offset=offset)


@router.get("/duplicates", response_model=DuplicatesPageResponse)
def duplicates(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, object]:
    return list_duplicates_page(get_settings(), limit=limit, offset=offset)
