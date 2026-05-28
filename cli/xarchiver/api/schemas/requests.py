from __future__ import annotations

from pydantic import BaseModel, Field


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


class SourceCreateRequest(BaseModel):
    source_type: str = Field(pattern="^(profile|user_media|likes|bookmarks|search|manual)$")
    source_url: str
    label: str | None = None
    author_username: str | None = None


class SourceRecordsRequest(BaseModel):
    records: list[ArchiveRecord]


class SourceStatusRequest(BaseModel):
    status: str = Field(pattern="^(active|paused|completed|failed)$")


class SourceScanRequest(BaseModel):
    limit: int = Field(default=20, ge=1, le=200)
    restart: bool = False


class SourceSubmitDiscoveredRequest(BaseModel):
    limit: int | None = Field(default=None, ge=1, le=500)


class SourceHistoryScanRequest(BaseModel):
    limit: int = Field(default=20, ge=1, le=200)
    restart: bool = False
