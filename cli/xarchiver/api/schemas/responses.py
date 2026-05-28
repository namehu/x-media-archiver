from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class FlexibleResponse(BaseModel):
    model_config = ConfigDict(extra="allow")


class PageResponse(FlexibleResponse):
    rows: list[dict[str, Any]]
    count: int
    total_count: int
    limit: int
    offset: int


class DuplicatesPageResponse(PageResponse):
    duplicate_groups: int


class SummaryResponse(FlexibleResponse):
    tweet_status_counts: dict[str, int]
    media_count: int
    failure_count: int
    archive_dir: str
    exports: list[dict[str, Any]]


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


class LatestRunResponse(FlexibleResponse):
    id: int
    trigger_type: str
    status: str
    started_at: Any
    finished_at: Any | None = None
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
    started_at: Any | None = None
    finished_at: Any | None = None
    created_at: Any


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
    occurred_at: Any | None = None


class HealthDetailResponse(FlexibleResponse):
    status: str
    worker: WorkerHealthResponse
    queue: QueueHealthResponse
    sources: SourceHealthResponse
    recent_errors: list[RecentErrorResponse]


class WriteActionResponse(FlexibleResponse):
    action: str
    status: str
    result: dict[str, Any]


class ArchiveSubmissionResponse(FlexibleResponse):
    run_id: int
    status: str
    input: dict[str, int]
    tasks: dict[str, int]


class ArchiveRunDetailResponse(FlexibleResponse):
    id: int
    trigger_type: str
    input_path: str | None = None
    status: str
    result: dict[str, Any] | None = None
    error_message: str | None = None
    items: list[dict[str, Any]]


class TweetDetailResponse(FlexibleResponse):
    tweet: dict[str, Any]
    media: list[dict[str, Any]]
    attempts: list[dict[str, Any]]


class ArchiveSourceResponse(FlexibleResponse):
    id: int
    source_type: str
    source_url: str
    status: str
    label: str | None = None
    author_username: str | None = None


class ArchiveSourceDetailResponse(ArchiveSourceResponse):
    discovered: list[dict[str, Any]]
    scan_summary: dict[str, Any]
    scan_runs: list[dict[str, Any]]
