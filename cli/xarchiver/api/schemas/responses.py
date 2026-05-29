from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class FlexibleResponse(BaseModel):
    model_config = ConfigDict(extra="allow")


class PageResponse(FlexibleResponse):
    rows: list[dict[str, Any]]
    count: int
    total_count: int
    limit: int
    offset: int


class PageMetaResponse(FlexibleResponse):
    count: int
    total_count: int
    limit: int
    offset: int


class SummaryResponse(FlexibleResponse):
    tweet_status_counts: dict[str, int]
    media_count: int
    failure_count: int
    archive_dir: str
    exports: list["ExportSummaryResponse"]


class ExportSummaryResponse(FlexibleResponse):
    name: str
    path: str
    size: int
    modified_at: float


class DownloadPolicyResponse(FlexibleResponse):
    queue_batch_size: int
    downloader_sleep_min_seconds: float
    downloader_sleep_max_seconds: float
    default_download_engine: str
    source_scan_batch_size: int
    source_scan_sleep_min_seconds: float
    source_scan_sleep_max_seconds: float


class WorkerHealthResponse(FlexibleResponse):
    stop_requested: bool
    write_lock_held: bool


class DbPoolHealthResponse(FlexibleResponse):
    active: int
    idle: int
    waiting: int
    min_size: int
    max_size: int


class LatestRunResponse(FlexibleResponse):
    id: int
    trigger_type: str
    status: str
    started_at: datetime
    finished_at: datetime | None = None
    error_message: str | None = None


class QueueHealthResponse(FlexibleResponse):
    pending_items: int
    processing_items: int
    retryable_failed_items: int
    permanent_failed_items: int
    queued_runs: int
    running_runs: int
    latest_run: LatestRunResponse | None = None


class LatestScanResponse(FlexibleResponse):
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


class SourceHealthResponse(FlexibleResponse):
    active_sources: int
    paused_sources: int
    failed_sources: int
    history_enabled_sources: int
    active_scan_runs: int
    latest_scan: LatestScanResponse | None = None


class RecentErrorResponse(FlexibleResponse):
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


class HealthDetailResponse(FlexibleResponse):
    status: str
    worker: WorkerHealthResponse
    db_pool: DbPoolHealthResponse
    queue: QueueHealthResponse
    sources: SourceHealthResponse
    recent_errors: list[RecentErrorResponse]


class WriteActionResponse(FlexibleResponse):
    action: str
    status: str
    result: dict[str, Any]


class ArchiveInputSummaryResponse(FlexibleResponse):
    input_record_count: int = 0
    unique_tweet_count: int = 0
    duplicate_input_count: int = 0


class ArchiveTaskCountsResponse(FlexibleResponse):
    queued_count: int = 0
    skipped_verified_count: int = 0
    linked_pending_count: int = 0
    verified_count: int = 0
    failed_count: int = 0
    pending_count: int = 0
    processing_count: int = 0
    failed_retryable_count: int = 0


class ArchiveMediaCountsResponse(FlexibleResponse):
    backfilled_media_count: int = 0
    verified_media_count: int = 0
    missing_media_count: int = 0
    corrupt_media_count: int = 0


class LibrarySnapshotResponse(FlexibleResponse):
    media_total: int = 0
    verified_total: int = 0


class ArchiveRunResultResponse(FlexibleResponse):
    pipeline_version: str | None = None
    scope: str | None = None
    input: ArchiveInputSummaryResponse | dict[str, Any] = Field(default_factory=dict)
    tasks: ArchiveTaskCountsResponse | dict[str, Any] = Field(default_factory=dict)
    media: ArchiveMediaCountsResponse | dict[str, Any] = Field(default_factory=dict)
    library_snapshot: LibrarySnapshotResponse | dict[str, Any] = Field(default_factory=dict)


class ArchiveSubmissionResponse(FlexibleResponse):
    run_id: int
    status: str
    input: ArchiveInputSummaryResponse
    tasks: ArchiveTaskCountsResponse


class DownloadAttemptResponse(FlexibleResponse):
    id: int
    job_id: int | None = None
    archive_run_item_id: int | None = None
    tweet_id: str | None = None
    engine: str | None = None
    status: str
    exit_code: int | None = None
    error_category: str | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class ArchiveRunItemResponse(FlexibleResponse):
    id: int
    tweet_id: str
    status: str
    retry_count: int
    error_category: str | None = None
    error_message: str | None = None
    linked_item_id: int | None = None
    last_attempt_at: datetime | None = None
    next_attempt_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    attempts: list[DownloadAttemptResponse] = Field(default_factory=list)


class ArchiveRunRowResponse(FlexibleResponse):
    id: int
    trigger_type: str
    input_path: str | None = None
    status: str
    started_at: datetime
    finished_at: datetime | None = None
    result: ArchiveRunResultResponse | dict[str, Any] | None = None
    error_message: str | None = None


class ArchiveRunDetailResponse(FlexibleResponse):
    id: int
    trigger_type: str
    input_path: str | None = None
    status: str
    started_at: datetime
    finished_at: datetime | None = None
    result: ArchiveRunResultResponse | dict[str, Any] | None = None
    error_message: str | None = None
    items: list[ArchiveRunItemResponse]


class TweetResponse(FlexibleResponse):
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


class MediaRowResponse(FlexibleResponse):
    tweet_id: str
    tweet_url: str
    author_username: str | None = None
    author_display_name: str | None = None
    published_at: datetime | None = None
    tweet_text: str | None = None
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
    media_relative_path: str
    media_url: str | None = None


class MediaAssetResponse(FlexibleResponse):
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
    media_relative_path: str
    media_url: str | None = None


class TweetDetailResponse(FlexibleResponse):
    tweet: TweetResponse
    media: list[MediaAssetResponse]
    attempts: list[DownloadAttemptResponse]


class FailureRowResponse(FlexibleResponse):
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


class DuplicateRowResponse(FlexibleResponse):
    sha256: str
    duplicate_count: int
    total_size: int
    tweet_id: str
    tweet_url: str
    author_username: str | None = None
    media_type: str | None = None
    media_status: str
    local_path: str | None = None
    file_size: int | None = None
    media_relative_path: str
    media_url: str | None = None


class MediaPageResponse(PageMetaResponse):
    rows: list[MediaRowResponse]


class FailurePageResponse(PageMetaResponse):
    rows: list[FailureRowResponse]


class ArchiveRunsPageResponse(PageMetaResponse):
    rows: list[ArchiveRunRowResponse]


class SourcesPageResponse(PageMetaResponse):
    rows: list["ArchiveSourceListResponse"]


class DuplicatesPageResponse(PageMetaResponse):
    rows: list[DuplicateRowResponse]
    duplicate_groups: int


class ArchiveSourceResponse(FlexibleResponse):
    id: int
    source_type: str
    source_url: str | None = None
    status: str
    label: str | None = None
    author_username: str | None = None


class ArchiveSourceListResponse(ArchiveSourceResponse):
    cursor_state: dict[str, Any] | None = None
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
    updated_at: datetime | None = None
    discovered_tweet_count: int = 0
    unsubmitted_tweet_count: int = 0
    discovered_media_count: int = 0
    latest_discovered_at: datetime | None = None


class SourceDiscoveryResponse(FlexibleResponse):
    id: int
    tweet_id: str
    archive_run_id: int | None = None
    discovered_at: datetime
    download_status: str
    author_username: str | None = None
    text: str | None = None
    raw_payload: dict[str, Any] | None = None


class SourceScanSummaryResponse(FlexibleResponse):
    batch_count: int
    added_tweet_count: int
    last_success_at: datetime | None = None
    last_error_at: datetime | None = None


class SourceScanRunResponse(FlexibleResponse):
    id: int
    trigger_type: str
    status: str
    range_start: int | None = None
    range_end: int | None = None
    requested_limit: int | None = None
    cursor_before: dict[str, Any] | None = None
    cursor_after: dict[str, Any] | None = None
    discovered_tweet_count: int
    new_tweet_count: int
    duplicate_tweet_count: int
    discovered_media_count: int
    error_category: str | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime


class ArchiveSourceDetailResponse(ArchiveSourceListResponse):
    discovered: list[SourceDiscoveryResponse]
    scan_summary: SourceScanSummaryResponse
    scan_runs: list[SourceScanRunResponse]
