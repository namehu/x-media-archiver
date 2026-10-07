"""来源类型及媒体来源的扫描范围。"""

from typing import Any
from urllib.parse import urlparse, urlunparse

LEGACY_MEDIA_SOURCE_TYPE = "user_media"
MEDIA_SOURCE_TYPES = {"user_photos", "user_videos"}
SCAN_SOURCE_TYPES = {"profile", "likes", *MEDIA_SOURCE_TYPES}
CREATE_SOURCE_TYPES = {*SCAN_SOURCE_TYPES, "bookmarks", "search", "manual"}
READ_SOURCE_TYPES = {*CREATE_SOURCE_TYPES, LEGACY_MEDIA_SOURCE_TYPE}


def require_current_source(source: dict[str, Any]) -> None:
    if source.get("source_type") == LEGACY_MEDIA_SOURCE_TYPE:
        raise ValueError("legacy_media_source_read_only")


def media_source_url(source_type: str, source_url: str) -> str:
    """类型决定媒体入口，两个类型始终保留为不同网址。"""
    if source_type not in MEDIA_SOURCE_TYPES:
        return source_url
    parsed = urlparse(source_url)
    parts = parsed.path.strip("/").split("/")
    if (
        len(parts) not in {1, 2}
        or (len(parts) == 2 and parts[1] != "media")
        or not parts[0]
        or parts[0].lower() in {"i", "home", "search", "explore", "notifications", "settings"}
    ):
        raise ValueError("invalid_source_url")
    query = "filter=photo" if source_type == "user_photos" else ""
    return urlunparse(("https", "x.com", f"/{parts[0]}/media", "", query, ""))


def filter_source_media_records(
    source_type: str,
    records: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """筛选含目标媒体的推文；混合推文保留完整媒体，下载仍按 Tweet 去重。"""
    if source_type not in MEDIA_SOURCE_TYPES:
        return records
    target = "photo" if source_type == "user_photos" else "video"
    return [record for record in records if target in record.get("media_types", [])]
