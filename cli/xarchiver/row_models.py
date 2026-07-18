from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class RowModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    def __getitem__(self, key: str) -> Any:
        return getattr(self, key)

    def get(self, key: str, default: Any = None) -> Any:
        return getattr(self, key, default)


class AuthAdminRow(RowModel):
    id: int
    username: str
    password_hash: str


class AuthSessionRow(RowModel):
    id: int
    username: str
    last_seen_at: datetime
    expires_at: datetime


class SearchMediaRow(RowModel):
    id: int
    tweet_id: str
    tweet_url: str
    author_username: str | None = None
    author_display_name: str | None = None
    published_at: datetime | None = None
    tweet_text: str
    tweet_status: str
    media_index: int | None = None
    media_type: str | None = None
    media_status: str
    source_engine: str | None = None
    local_path: str | None = None
    file_size: int | None = None
    width: int | None = None
    height: int | None = None
    duration_ms: int | None = None


class AuthorOptionRow(RowModel):
    author_username: str
    author_display_name: str | None = None
    media_count: int


class PostFeedRow(RowModel):
    tweet_id: str
    tweet_url: str
    author_username: str | None = None
    author_display_name: str | None = None
    published_at: datetime | None = None
    tweet_text: str
    tweet_status: str


class PostFeedMediaRow(RowModel):
    id: int
    tweet_id: str
    media_index: int | None = None
    media_type: str | None = None
    media_status: str
    source_engine: str | None = None
    local_path: str | None = None
    file_size: int | None = None
    width: int | None = None
    height: int | None = None
    duration_ms: int | None = None


class TweetDetailRow(RowModel):
    tweet_id: str
    tweet_url: str
    author_username: str | None = None
    author_display_name: str | None = None
    published_at: datetime | None = None
    tweet_text: str | None = None
    tweet_status: str
    last_error: str | None = None
    retry_count: int
    imported_at: datetime
    updated_at: datetime


class TweetMediaAssetRow(RowModel):
    id: int
    media_index: int | None = None
    media_type: str | None = None
    media_status: str
    source_engine: str | None = None
    local_path: str | None = None
    metadata_path: str | None = None
    original_filename: str | None = None
    file_ext: str | None = None
    file_size: int | None = None
    sha256: str | None = None
    width: int | None = None
    height: int | None = None
    duration_ms: int | None = None
    error_message: str | None = None
    updated_at: datetime


class DownloadAttemptRow(RowModel):
    id: int
    job_id: int | None = None
    engine: str | None = None
    status: str
    exit_code: int | None = None
    error_category: str | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class ArchiveRunRow(RowModel):
    id: int
    trigger_type: str
    source_id: int | None = None
    input_path: str | None = None
    status: str
    blocked_by_run_id: int | None = None
    control_state: dict[str, Any] | None = None
    started_at: datetime
    finished_at: datetime | None = None
    result: dict[str, Any] | None = None
    error_message: str | None = None


class ArchiveRunItemRow(RowModel):
    id: int
    tweet_id: str
    status: str
    retry_count: int
    error_category: str | None = None
    error_message: str | None = None
    linked_item_id: int | None = None
    cancel_requested: bool = False
    downloaded_bytes: int = 0
    total_bytes: int | None = None
    speed_bps: int | None = None
    progress_message: str | None = None
    last_progress_at: datetime | None = None
    last_attempt_at: datetime | None = None
    next_attempt_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ArchiveRunAttemptRow(DownloadAttemptRow):
    archive_run_item_id: int
    tweet_id: str | None = None


class ArchiveClaimedItemRow(RowModel):
    id: int
    archive_run_id: int
    tweet_id: str
    retry_count: int
    worker_id: str | None = None
    cancel_requested: bool = False


class LatestItemErrorRow(RowModel):
    archive_run_item_id: int
    error_category: str | None = None
    error_message: str | None = None
    stderr_excerpt: str | None = None


class UrlRow(RowModel):
    url: str


class IdRow(RowModel):
    id: int


class InsertedFlagRow(RowModel):
    inserted: bool


class CursorStateRow(RowModel):
    cursor_state: dict[str, Any]


class RawPayloadRow(RowModel):
    raw_payload: dict[str, Any] | None = None


class TweetStatusRow(RowModel):
    tweet_id: str
    download_status: str


class DownloadStatusRow(RowModel):
    download_status: str


class TweetIdRow(RowModel):
    tweet_id: str


class TweetRow(RowModel):
    tweet_id: str
    url: str
    author_username: str | None = None
    author_display_name: str | None = None
    published_at: datetime | None = None
    text: str | None = None
    source_type: str | None = None
    source_url: str | None = None
    collected_at: datetime | None = None
    imported_at: datetime
    download_status: str
    raw_import: dict[str, Any] | None = None
    last_error: str | None = None
    retry_count: int
    last_attempt_at: datetime | None = None
    updated_at: datetime


class ArchiveSourceRow(RowModel):
    id: int
    source_type: str
    source_url: str | None = None
    label: str | None = None
    author_username: str | None = None
    status: str
    is_pinned: bool = False
    cursor_state: dict[str, Any]
    last_seen_tweet_id: str | None = None
    newest_seen_tweet_id: str | None = None
    oldest_seen_tweet_id: str | None = None
    discovered_count: int
    submitted_count: int
    error_category: str | None = None
    error_message: str | None = None
    last_scan_at: datetime | None = None
    next_scan_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ArchiveSourceListRow(ArchiveSourceRow):
    discovered_tweet_count: int
    unsubmitted_tweet_count: int
    discovered_media_count: int
    scan_batch_count: int = 0
    latest_discovered_at: datetime | None = None


class SourceDiscoveryRow(RowModel):
    id: int
    tweet_id: str
    archive_run_id: int | None = None
    discovered_at: datetime
    download_status: str
    author_username: str | None = None
    text: str | None = None
    raw_payload: dict[str, Any] | None = None
    active_run_id: int | None = None
    active_item_id: int | None = None
    active_item_status: str | None = None
    active_run_status: str | None = None
    cancel_requested: bool | None = None
    downloaded_bytes: int | None = None
    total_bytes: int | None = None
    speed_bps: int | None = None
    progress_message: str | None = None
    last_progress_at: datetime | None = None
    downloaded_media_count: int = 0
    downloaded_media_bytes: int = 0


class SourceScanSummaryRow(RowModel):
    batch_count: int
    added_tweet_count: int
    last_success_at: datetime | None = None
    last_error_at: datetime | None = None


class SourceScanRunRow(RowModel):
    id: int
    trigger_type: str
    status: str
    range_start: int | None = None
    range_end: int | None = None
    requested_limit: int | None = None
    cursor_before: dict[str, Any]
    cursor_after: dict[str, Any] | None = None
    discovered_tweet_count: int
    new_tweet_count: int
    duplicate_tweet_count: int
    discovered_media_count: int
    error_category: str | None = None
    error_message: str | None = None
    progress_message: str | None = None
    log_stream_id: int | None = None
    log_path: str | None = None
    last_log_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime


class OperationLogStreamRow(RowModel):
    id: int
    scope_type: str
    scope_id: int
    log_path: str
    metadata: dict[str, Any]
    line_count: int
    byte_size: int
    level_counts: dict[str, int]
    last_level: str | None = None
    last_message: str | None = None
    last_log_at: datetime | None = None
    is_truncated: bool
    created_at: datetime
    closed_at: datetime | None = None


class ExportMediaRow(SearchMediaRow):
    metadata_path: str | None = None
    original_filename: str | None = None
    file_ext: str | None = None
    sha256: str | None = None


class FailureRow(RowModel):
    tweet_id: str
    tweet_url: str
    author_username: str | None = None
    tweet_status: str
    last_error: str | None = None
    retry_count: int
    latest_engine: str | None = None
    latest_attempt_status: str | None = None
    latest_error_category: str | None = None
    latest_error_message: str | None = None
    latest_exit_code: int | None = None
    latest_finished_at: datetime | None = None


class DuplicateRow(RowModel):
    sha256: str
    duplicate_count: int
    total_size: int
    id: int
    tweet_id: str
    tweet_url: str
    author_username: str | None = None
    media_index: int | None = None
    media_type: str | None = None
    media_status: str
    local_path: str | None = None
    file_size: int | None = None


class StatusCountRow(RowModel):
    status: str
    count: int


class DownloadStatusCountRow(RowModel):
    download_status: str
    count: int


class QueueLatestRunRow(RowModel):
    id: int
    trigger_type: str
    status: str
    started_at: datetime
    finished_at: datetime | None = None
    error_message: str | None = None


class SourceLatestScanRow(RowModel):
    id: int
    source_id: int
    trigger_type: str
    status: str
    requested_limit: int | None = None
    error_category: str | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime


class RecentErrorRow(RowModel):
    kind: str
    id: str
    subject: str
    archive_run_id: int | None = None
    archive_run_item_id: int | None = None
    tweet_id: str | None = None
    source_id: int | None = None
    source_scan_run_id: int | None = None
    target_path: str | None = None
    error_category: str | None = None
    error_message: str | None = None
    occurred_at: datetime | None = None


class DownloadCandidateRow(RowModel):
    tweet_id: str
    url: str


class VerifiableAssetRow(RowModel):
    id: int
    tweet_id: str
    local_path: str | None = None
    sha256: str | None = None
