"""API 请求体模型。

这个文件主要描述 WebUI 提交到后端的写操作载荷，重点是约束输入格式、
长度范围和允许的枚举值。
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


# 维护动作请求
class VerifyRequest(BaseModel):
    limit: int | None = Field(default=None, ge=1)
    confirm_full_scan: bool = False


class BackfillRequest(BaseModel):
    confirm_full_scan: bool = False
    normalize_files: bool = True


class RequeueRequest(BaseModel):
    statuses: list[str] | None = None
    limit: int | None = Field(default=None, ge=1)


class RecoverInterruptedRequest(BaseModel):
    timeout_minutes: int | None = Field(default=None, ge=1)


class ExportRequest(BaseModel):
    kind: str = Field(default="media", pattern="^(media|failures|duplicates)$")
    status: str | None = "verified"


class MediaDeleteRequest(BaseModel):
    operation_id: UUID
    media_ids: list[int] = Field(min_length=1, max_length=200)
    confirm_physical_delete: bool = False


# 归档队列请求
class ArchiveRecord(BaseModel):
    url: str
    author_username: str | None = None
    author_display_name: str | None = None
    text: str | None = None
    published_at: str | None = None
    datetime: str | None = None
    collected_at: str | None = None
    source_url: str | None = None


class ArchiveSubmitRequest(BaseModel):
    trigger_type: str = "webui"
    records: list[ArchiveRecord]


class ArchiveRunCancelItemsRequest(BaseModel):
    item_ids: list[int] | None = None
    tweet_ids: list[str] | None = None


# 来源管理与扫描请求
class SourceCreateRequest(BaseModel):
    source_type: str = Field(pattern="^(profile|user_media|likes|bookmarks|search|manual)$")
    source_url: str
    label: str | None = None
    author_username: str | None = None


class SourceRecordsRequest(BaseModel):
    records: list[ArchiveRecord]


class SourceStatusRequest(BaseModel):
    status: str = Field(pattern="^(active|paused|completed|failed)$")


class SourcePinRequest(BaseModel):
    is_pinned: bool


class SourceDeleteRequest(BaseModel):
    confirm_delete: bool = False


class SourceScanRequest(BaseModel):
    limit: int = Field(default=20, ge=5, le=200)
    restart: bool = False


class SourceSubmitDiscoveredRequest(BaseModel):
    limit: int | None = Field(default=None, ge=1, le=500)


class SourceDownloadRequest(BaseModel):
    scope: str = Field(
        pattern="^(selected|all_unsubmitted|failed|download_missing|retry_failed|redownload_filter|current_filter)$"
    )
    tweet_ids: list[str] | None = None
    confirm_all: bool = False
    limit: int | None = Field(default=None, ge=1, le=5000)
    media_type: str | None = Field(default=None, pattern="^(video|photo)$")


class SourceHistoryScanRequest(BaseModel):
    limit: int = Field(default=20, ge=5, le=200)
    restart: bool = False


class SourceScanSessionRequest(BaseModel):
    mode: str = Field(pattern="^(history|latest_refresh|from_start)$")
    limit: int = Field(default=20, ge=5, le=200)
    restart: bool = False


# 配置与认证请求
class UpdateCookiesRequest(BaseModel):
    content: str = Field(max_length=1024 * 1024)
    label: str | None = None


class AuthSetupRequest(BaseModel):
    setup_token: str = Field(min_length=20, max_length=256)
    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    password: str = Field(min_length=12, max_length=128)


class AuthLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class AuthPasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)
