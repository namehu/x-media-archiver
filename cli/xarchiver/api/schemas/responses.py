"""API 响应模型。

这里按页面和接口语义定义响应结构，尽量保持与 service 层返回的数据形状
一致，同时用 Pydantic 为 FastAPI 提供稳定的 schema。
"""

from __future__ import annotations

from datetime import datetime, time
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class FlexibleResponse(BaseModel):
    """允许附加字段透传的宽松响应基类。"""

    model_config = ConfigDict(extra="allow")


class PageMetaResponse(FlexibleResponse):
    """分页接口共用的元信息。"""

    count: int
    total_count: int
    limit: int
    offset: int


# 仪表盘与健康检查相关响应
class SummaryResponse(FlexibleResponse):
    tweet_status_counts: dict[str, int]
    media_count: int
    failure_count: int
    archive_dir: str
    exports: list[ExportSummaryResponse]


class ExportSummaryResponse(FlexibleResponse):
    name: str
    path: str
    size: int
    modified_at: float


class DownloadPolicyResponse(FlexibleResponse):
    queue_batch_size: int
    downloader_sleep_min_seconds: float
    downloader_sleep_max_seconds: float
    downloader_progress_fallback_interval_seconds: float
    default_download_engine: str
    source_scan_batch_size: int
    source_scan_sleep_min_seconds: float
    source_scan_sleep_max_seconds: float
    source_scan_http_timeout_seconds: float
    source_scan_http_retries: int


class CookieConfigResponse(FlexibleResponse):
    configured: bool
    source: str
    label: str | None = None
    updated_at: datetime | None = None
    validation_status: str
    validated_at: datetime | None = None
    auth_token_expires_at: datetime | None = None
    validation_error_category: str | None = None
    validation_message: str | None = None


class AuthUserResponse(FlexibleResponse):
    username: str


class AuthSessionResponse(FlexibleResponse):
    status: str
    auth_mode: str
    user: AuthUserResponse | None = None


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


class RuntimeTransportDiagnosticsResponse(FlexibleResponse):
    broker: dict[str, Any]
    websocket: dict[str, int]


class RuntimeGlobalResponse(FlexibleResponse):
    active_run_count: int = 0
    active_item_count: int = 0
    active_scan_count: int = 0
    current_run_id: int | None = None
    current_source_id: int | None = None
    current_tweet_id: str | None = None
    downloaded_bytes: int = 0
    total_bytes: int | None = None
    speed_bps: int | None = None


class RuntimeRunResponse(FlexibleResponse):
    id: int
    trigger_type: str
    source_id: int | None = None
    input_path: str | None = None
    status: str
    blocked_by_run_id: int | None = None
    control_state: dict[str, Any] | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    result: dict[str, Any] | None = None
    error_message: str | None = None
    downloaded_bytes: int = 0
    total_bytes: int | None = None
    speed_bps: int | None = None
    active_item_count: int = 0
    job_id: int | None = None
    current_tweet_id: str | None = None
    job_status: str | None = None
    last_progress_at: datetime | None = None


class RuntimeItemResponse(FlexibleResponse):
    id: int
    archive_run_item_id: int
    archive_run_id: int
    source_id: int | None = None
    archive_run_status: str | None = None
    tweet_id: str
    status: str
    retry_count: int = 0
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
    created_at: datetime | None = None
    updated_at: datetime | None = None


class RuntimeSnapshotResponse(FlexibleResponse):
    epoch: str
    sequence: int
    recent_window_seconds: int
    worker: WorkerHealthResponse
    queue: QueueHealthResponse
    sources: SourceHealthResponse
    global_: RuntimeGlobalResponse = Field(alias="global")
    runs: list[RuntimeRunResponse] = Field(default_factory=list)
    items: list[RuntimeItemResponse] = Field(default_factory=list)
    scans: list[SourceScanRunResponse] = Field(default_factory=list)
    recent_activity: list[dict[str, Any]] = Field(default_factory=list)


class WriteActionResponse(FlexibleResponse):
    action: str
    status: str
    result: dict[str, Any]


# 归档运行相关响应
class ArchiveInputSummaryResponse(FlexibleResponse):
    input_record_count: int = 0
    unique_tweet_count: int = 0
    duplicate_input_count: int = 0


class ArchiveTaskCountsResponse(FlexibleResponse):
    queued_count: int = 0
    blocked_count: int = 0
    skipped_verified_count: int = 0
    skipped_ignored_count: int = 0
    linked_pending_count: int = 0
    linked_active_count: int = 0
    skipped_completed_count: int = 0
    verified_count: int = 0
    failed_count: int = 0
    cancelled_count: int = 0
    pending_count: int = 0
    blocked_item_count: int = 0
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
    input: ArchiveInputSummaryResponse = Field(default_factory=ArchiveInputSummaryResponse)
    tasks: ArchiveTaskCountsResponse = Field(default_factory=ArchiveTaskCountsResponse)
    media: ArchiveMediaCountsResponse = Field(default_factory=ArchiveMediaCountsResponse)
    library_snapshot: LibrarySnapshotResponse = Field(default_factory=LibrarySnapshotResponse)


class ArchiveSubmissionResponse(FlexibleResponse):
    run_id: int | None = None
    status: str
    source_id: int | None = None
    blocked_by_run_id: int | None = None
    input: ArchiveInputSummaryResponse
    tasks: ArchiveTaskCountsResponse


class ArchiveRunControlResponse(FlexibleResponse):
    run_id: int
    status: str
    affected_count: int = 0


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
    stderr_excerpt: str | None = None
    log_stream_id: int | None = None
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
    attempts: list[DownloadAttemptResponse] = Field(default_factory=list)


class ArchiveRunRowResponse(FlexibleResponse):
    id: int
    trigger_type: str
    source_id: int | None = None
    input_path: str | None = None
    status: str
    blocked_by_run_id: int | None = None
    control_state: dict[str, Any] | None = None
    started_at: datetime
    finished_at: datetime | None = None
    result: ArchiveRunResultResponse | None = None
    error_message: str | None = None


class ArchiveRunDetailResponse(FlexibleResponse):
    id: int
    trigger_type: str
    source_id: int | None = None
    input_path: str | None = None
    status: str
    blocked_by_run_id: int | None = None
    control_state: dict[str, Any] | None = None
    started_at: datetime
    finished_at: datetime | None = None
    result: ArchiveRunResultResponse | None = None
    error_message: str | None = None
    items: list[ArchiveRunItemResponse]


# 媒体库与推文视图响应
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
    id: int
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
    preview_relative_path: str | None = None
    preview_url: str | None = None


class AuthorOptionResponse(FlexibleResponse):
    author_username: str
    author_display_name: str | None = None
    media_count: int


class AuthorOptionsResponse(FlexibleResponse):
    rows: list[AuthorOptionResponse]
    count: int


class PostFeedMediaResponse(FlexibleResponse):
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
    media_relative_path: str
    media_url: str | None = None
    preview_relative_path: str | None = None
    preview_url: str | None = None


class PostFeedRowResponse(FlexibleResponse):
    tweet_id: str
    tweet_url: str
    author_username: str | None = None
    author_display_name: str | None = None
    published_at: datetime | None = None
    tweet_text: str
    tweet_status: str
    tags: list[str] = Field(default_factory=list)
    collection_count: int = 0
    has_note: bool = False
    media: list[PostFeedMediaResponse]


class PostFeedPageResponse(PageMetaResponse):
    rows: list[PostFeedRowResponse]


class TweetSearchRowResponse(PostFeedRowResponse):
    relevance: float = 0.0
    tags: list[str] = Field(default_factory=list)
    collections: list[str] = Field(default_factory=list)
    note_excerpt: str | None = None


class TweetSearchPageResponse(PageMetaResponse):
    rows: list[TweetSearchRowResponse]


class TweetSearchTagOptionResponse(FlexibleResponse):
    id: int
    name: str
    color: str | None = None
    tweet_count: int


class TweetSearchCollectionOptionResponse(FlexibleResponse):
    id: int
    name: str
    tweet_count: int


class TweetSearchOptionsResponse(FlexibleResponse):
    tags: list[TweetSearchTagOptionResponse] = Field(default_factory=list)
    collections: list[TweetSearchCollectionOptionResponse] = Field(default_factory=list)


class OrganizationTagResponse(FlexibleResponse):
    id: int
    name: str
    normalized_name: str
    color: str | None = None
    description: str | None = None
    tweet_count: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class OrganizationCoverResponse(FlexibleResponse):
    id: int
    media_type: str | None = None
    media_url: str


class OrganizationCollectionResponse(FlexibleResponse):
    id: int
    name: str
    normalized_name: str
    description: str | None = None
    cover_media_id: int | None = None
    cover: OrganizationCoverResponse | None = None
    tweet_count: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class TweetNoteResponse(FlexibleResponse):
    content: str
    created_at: datetime
    updated_at: datetime


class TweetOrganizationResponse(FlexibleResponse):
    tweet_id: str
    tags: list[OrganizationTagResponse] = Field(default_factory=list)
    collections: list[OrganizationCollectionResponse] = Field(default_factory=list)
    note: TweetNoteResponse | None = None


class OrganizationCatalogResponse(FlexibleResponse):
    tags: list[OrganizationTagResponse] = Field(default_factory=list)
    collections: list[OrganizationCollectionResponse] = Field(default_factory=list)


class OrganizationCollectionPageResponse(PageMetaResponse):
    collection: OrganizationCollectionResponse
    rows: list[TweetSearchRowResponse]


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
    preview_relative_path: str | None = None
    preview_url: str | None = None


class TweetDetailResponse(FlexibleResponse):
    tweet: TweetResponse
    media: list[MediaAssetResponse]
    attempts: list[DownloadAttemptResponse]
    organization: TweetOrganizationResponse


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
    failure_at: datetime | None = None
    disposition: str = "open"
    ignored_at: datetime | None = None
    ignore_reason: str | None = None
    ignore_note: str | None = None
    latest_action: str | None = None
    latest_action_at: datetime | None = None
    latest_action_archive_run_id: int | None = None


class FailureAggregateResponse(FlexibleResponse):
    total_count: int = 0
    open_count: int = 0
    ignored_count: int = 0
    retryable_count: int = 0
    permanent_count: int = 0
    corrupt_count: int = 0
    retry_total: int = 0


class FailureCategoryResponse(FlexibleResponse):
    error_category: str
    count: int


class FailureActionEventResponse(FlexibleResponse):
    id: int
    tweet_id: str
    action: str
    previous_status: str
    reason: str | None = None
    note: str | None = None
    archive_run_id: int | None = None
    result: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class FailureActionsResponse(FlexibleResponse):
    rows: list[FailureActionEventResponse]
    count: int


class DuplicateMediaResponse(FlexibleResponse):
    id: int
    tweet_id: str
    tweet_url: str
    author_username: str | None = None
    media_index: int | None = None
    media_type: str | None = None
    media_status: str
    local_path: str | None = None
    file_size: int | None = None
    media_relative_path: str
    media_url: str | None = None


class DuplicateGroupResponse(FlexibleResponse):
    sha256: str
    duplicate_count: int
    total_size: int
    rows: list[DuplicateMediaResponse]


class MediaPageResponse(PageMetaResponse):
    rows: list[MediaRowResponse]


class FailurePageResponse(PageMetaResponse):
    rows: list[FailureRowResponse]
    aggregates: FailureAggregateResponse = Field(default_factory=FailureAggregateResponse)
    disposition_counts: FailureAggregateResponse = Field(default_factory=FailureAggregateResponse)
    error_categories: list[FailureCategoryResponse] = Field(default_factory=list)


class ArchiveRunsPageResponse(PageMetaResponse):
    rows: list[ArchiveRunRowResponse]


class SourcesPageResponse(PageMetaResponse):
    rows: list[ArchiveSourceListResponse]


class DuplicatesPageResponse(PageMetaResponse):
    groups: list[DuplicateGroupResponse]
    duplicate_groups: int
    total_media_count: int


# 来源管理与来源扫描相关响应
class ArchiveSourceResponse(FlexibleResponse):
    id: int
    source_type: str
    source_url: str | None = None
    status: str
    is_pinned: bool = False
    manual_order: int = 0
    label: str | None = None
    author_username: str | None = None
    deleted_at: datetime | None = None


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
    scan_batch_count: int = 0
    latest_discovered_at: datetime | None = None
    latest_tweet_published_at: datetime | None = None
    last_success_at: datetime | None = None
    last_error_at: datetime | None = None
    pending_download_count: int = 0
    processing_download_count: int = 0
    failed_download_count: int = 0
    schedule_enabled: bool = False
    schedule_next_run_at: datetime | None = None
    schedule_policy_label: str | None = None
    active_bulk_task_item_status: str | None = None


class SourceDiscoveryResponse(FlexibleResponse):
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
    progress_message: str | None = None
    log_stream_id: int | None = None
    log_path: str | None = None
    last_log_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime


class SourceDiscoveryMediaFacetsResponse(FlexibleResponse):
    all: int = 0
    video: int = 0
    photo: int = 0


class SourceDiscoveryQueueFacetsResponse(FlexibleResponse):
    unsubmitted: int = 0
    submitted: int = 0


class SourceDiscoveryDownloadFacetsResponse(FlexibleResponse):
    pending: int = 0
    active: int = 0
    completed: int = 0
    failed: int = 0


class SourceDiscoveryFacetsResponse(FlexibleResponse):
    media: SourceDiscoveryMediaFacetsResponse = Field(default_factory=SourceDiscoveryMediaFacetsResponse)
    queue: SourceDiscoveryQueueFacetsResponse = Field(default_factory=SourceDiscoveryQueueFacetsResponse)
    download: SourceDiscoveryDownloadFacetsResponse = Field(default_factory=SourceDiscoveryDownloadFacetsResponse)


class SourceDiscoveryActionCountsResponse(FlexibleResponse):
    all_unsubmitted: int = 0
    missing: int = 0
    failed: int = 0


class SourceDiscoveryPageResponse(PageMetaResponse):
    rows: list[SourceDiscoveryResponse]
    unfiltered_total_count: int = 0
    action_counts: SourceDiscoveryActionCountsResponse = Field(default_factory=SourceDiscoveryActionCountsResponse)
    facets: SourceDiscoveryFacetsResponse | None = None


class SourceDownloadCountsResponse(FlexibleResponse):
    total_count: int = 0
    settled_count: int = 0
    pending_count: int = 0
    blocked_count: int = 0
    processing_count: int = 0
    failed_retryable_count: int = 0
    verified_count: int = 0
    skipped_verified_count: int = 0
    skipped_ignored_count: int = 0
    linked_pending_count: int = 0
    failed_permanent_count: int = 0
    cancelled_count: int = 0


class SourceDownloadSummaryResponse(FlexibleResponse):
    source_id: int
    current_tweet_id: str | None = None
    active_run: ArchiveRunDetailResponse | None = None
    active_counts: SourceDownloadCountsResponse = Field(default_factory=SourceDownloadCountsResponse)
    paused_runs: list[ArchiveRunRowResponse] = Field(default_factory=list)
    blocked_runs: list[ArchiveRunRowResponse] = Field(default_factory=list)
    recent_runs: list[ArchiveRunRowResponse] = Field(default_factory=list)
    pending_count: int = 0
    blocked_count: int = 0
    processing_count: int = 0
    paused_count: int = 0
    failed_count: int = 0
    completed_count: int = 0
    cancelled_count: int = 0
    downloaded_bytes: int = 0
    total_bytes: int | None = None
    speed_bps: int | None = None


class SourceScanRunsPageResponse(PageMetaResponse):
    rows: list[SourceScanRunResponse]


class ArchiveSourceDetailResponse(ArchiveSourceListResponse):
    scan_summary: SourceScanSummaryResponse
    active_scan_run: SourceScanRunResponse | None = None


class SourceDeleteResponse(FlexibleResponse):
    source_id: int
    deleted_at: datetime


class SourceBulkTaskItemResponse(FlexibleResponse):
    id: int
    task_id: int
    source_id: int
    position: int
    wave_index: int
    status: str
    scan_run_ids: list[int] = Field(default_factory=list)
    archive_run_id: int | None = None
    discovered_count: int = 0
    new_tweet_count: int = 0
    submitted_count: int = 0
    skip_reason: str | None = None
    error_category: str | None = None
    error_message: str | None = None
    label: str | None = None
    author_username: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class SourceBulkTaskResponse(FlexibleResponse):
    id: int
    task_type: str
    trigger_type: str
    status: str
    schedule_policy_id: int | None = None
    source_filter: dict[str, Any] = Field(default_factory=dict)
    options: dict[str, Any] = Field(default_factory=dict)
    total_count: int
    error_category: str | None = None
    error_message: str | None = None
    counts: dict[str, int] = Field(default_factory=dict)
    settled_count: int = 0
    progress: float = 0
    items: list[SourceBulkTaskItemResponse] = Field(default_factory=list)
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class SourceBulkTasksPageResponse(PageMetaResponse):
    rows: list[SourceBulkTaskResponse]


class SourceSchedulePolicyResponse(FlexibleResponse):
    id: int
    label: str
    action: str
    frequency_kind: str
    interval_minutes: int | None = None
    local_time: time | None = None
    weekday: int | None = None
    timezone: str
    jitter_seconds: int
    max_downloads_per_source: int
    max_downloads_per_task: int
    enabled: bool
    next_run_at: datetime | None = None
    last_run_at: datetime | None = None
    source_count: int = 0
    source_ids: list[int] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


# 操作日志相关响应
class OperationLogStreamResponse(FlexibleResponse):
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


class OperationLogStreamsPageResponse(FlexibleResponse):
    rows: list[OperationLogStreamResponse]
    count: int
    total_count: int
    limit: int
    offset: int


class OperationLogEntryResponse(FlexibleResponse):
    timestamp: str
    level: str
    component: str
    message: str
    raw: str | None = None
    context: dict[str, object] | None = None
    exception: dict[str, object] | None = None


class OperationLogEntriesResponse(FlexibleResponse):
    stream: OperationLogStreamResponse
    entries: list[OperationLogEntryResponse]
    next_cursor: int
    available: bool
    is_truncated: bool
