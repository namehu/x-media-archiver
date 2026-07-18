export { ApiError, apiDelete, apiGet, apiPost, apiRequest, apiUrl } from "../api/client";

export type Summary = {
  tweet_status_counts: Record<string, number>;
  media_count: number;
  failure_count: number;
  archive_dir: string;
  exports: Array<{ name: string; path: string; size: number; modified_at: number }>;
};

export type MediaRow = {
  id: number;
  tweet_id: string;
  tweet_url?: string | null;
  author_username?: string | null;
  author_display_name?: string | null;
  published_at?: string | null;
  tweet_text?: string | null;
  tweet_status?: string | null;
  media_index?: number | null;
  media_type?: string | null;
  media_status?: string | null;
  source_engine?: string | null;
  local_path?: string | null;
  media_relative_path?: string | null;
  media_url?: string | null;
  file_size?: number | null;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  sha256?: string | null;
  duplicate_count?: number | null;
  total_size?: number | null;
  error_message?: string | null;
};

export type AuthorOption = {
  author_username: string;
  author_display_name?: string | null;
  media_count: number;
};

export type AuthorOptionsResponse = {
  rows: AuthorOption[];
  count: number;
};

export type PostFeedMedia = {
  id: number;
  tweet_id: string;
  media_index?: number | null;
  media_type?: string | null;
  media_status: string;
  source_engine?: string | null;
  local_path?: string | null;
  media_relative_path: string;
  media_url?: string | null;
  file_size?: number | null;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
};

export type PostFeedRow = {
  tweet_id: string;
  tweet_url: string;
  author_username?: string | null;
  author_display_name?: string | null;
  published_at?: string | null;
  tweet_text: string;
  tweet_status: string;
  media: PostFeedMedia[];
};

export type PostFeedPageResponse = PageResponse<PostFeedRow>;

export type FailureRow = {
  tweet_id: string;
  tweet_url?: string | null;
  author_username?: string | null;
  tweet_status?: string | null;
  last_error?: string | null;
  retry_count?: number | null;
  latest_engine?: string | null;
  latest_attempt_status?: string | null;
  latest_error_category?: string | null;
  latest_error_message?: string | null;
  latest_exit_code?: number | null;
  latest_finished_at?: string | null;
};

export type PageResponse<T> = {
  rows: T[];
  count: number;
  total_count: number;
  limit: number;
  offset: number;
};

export type DuplicateGroup = {
  sha256: string;
  duplicate_count: number;
  total_size: number;
  rows: MediaRow[];
};

export type DuplicatesResponse = {
  groups: DuplicateGroup[];
  count: number;
  total_count: number;
  limit: number;
  offset: number;
  duplicate_groups: number;
  total_media_count: number;
};

export type TweetDetail = {
  tweet: MediaRow & {
    last_error?: string | null;
    retry_count?: number | null;
    imported_at?: string | null;
    updated_at?: string | null;
  };
  media: MediaRow[];
  attempts: Array<{
    id: number;
    job_id: number;
    engine?: string | null;
    status?: string | null;
    exit_code?: number | null;
    error_category?: string | null;
    error_message?: string | null;
    finished_at?: string | null;
  }>;
};

export type ActionResponse = {
  action: string;
  status: string;
  result: Record<string, unknown>;
};

export type MediaDeleteResult = {
  operation_id: string;
  deleted_media_count: number;
  deleted_file_count: number;
  deleted_bytes: number;
  missing_file_count: number;
  tweet_ids: string[];
};

export type ArchiveRunTasks = {
  queued_count: number;
  blocked_count?: number;
  skipped_verified_count: number;
  linked_pending_count: number;
  linked_active_count?: number;
  skipped_completed_count?: number;
  verified_count: number;
  failed_count: number;
  cancelled_count?: number;
  pending_count?: number;
  blocked_item_count?: number;
  processing_count?: number;
  failed_retryable_count?: number;
};

export type ArchiveRun = {
  id: number;
  trigger_type: string;
  source_id?: number | null;
  input_path?: string | null;
  status: "queued" | "blocked" | "running" | "paused" | "stopped" | "completed" | "completed_with_failures" | "failed";
  blocked_by_run_id?: number | null;
  control_state?: Record<string, unknown> | null;
  started_at: string;
  finished_at?: string | null;
  error_message?: string | null;
  result?: {
    pipeline_version?: string;
    tasks?: ArchiveRunTasks;
  } | null;
};

export type ArchiveRunItem = {
  id: number;
  tweet_id: string;
  status: string;
  retry_count: number;
  last_attempt_at?: string | null;
  next_attempt_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  error_category?: string | null;
  error_message?: string | null;
  linked_item_id?: number | null;
  cancel_requested?: boolean | null;
  downloaded_bytes?: number | null;
  total_bytes?: number | null;
  speed_bps?: number | null;
  progress_message?: string | null;
  last_progress_at?: string | null;
  attempts?: Array<{
    id: number;
    job_id: number;
    engine?: string | null;
    status?: string | null;
    exit_code?: number | null;
    error_category?: string | null;
    error_message?: string | null;
    started_at?: string | null;
    finished_at?: string | null;
  }>;
};

export type ArchiveRunDetail = ArchiveRun & {
  items: ArchiveRunItem[];
};

export type ArchiveRunPageResponse = PageResponse<ArchiveRun>;

export type ArchiveSubmission = {
  run_id?: number | null;
  source_id?: number;
  blocked_by_run_id?: number | null;
  status: string;
  input: {
    input_record_count: number;
    unique_tweet_count: number;
    duplicate_input_count: number;
  };
  tasks: {
    queued_count: number;
    blocked_count?: number;
    skipped_verified_count: number;
    linked_pending_count: number;
    linked_active_count?: number;
    skipped_completed_count?: number;
  };
};

export type SourceScanRun = {
  id: number;
  trigger_type: "history_worker" | "manual_next" | "latest_refresh" | "from_start_repair";
  status:
    | "running"
    | "waiting_downloads"
    | "succeeded"
    | "completed_empty_batch"
    | "completed_end_of_source"
    | "rate_limited"
    | "auth_required"
    | "network_error"
    | "failed";
  range_start?: number | null;
  range_end?: number | null;
  requested_limit?: number | null;
  cursor_before?: Record<string, unknown> | null;
  cursor_after?: Record<string, unknown> | null;
  discovered_tweet_count: number;
  new_tweet_count: number;
  duplicate_tweet_count: number;
  discovered_media_count: number;
  error_category?: string | null;
  error_message?: string | null;
  progress_message?: string | null;
  log_stream_id?: number | null;
  log_path?: string | null;
  last_log_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
};

export type OperationLogStream = {
  id: number;
  scope_type: string;
  scope_id: number;
  log_path: string;
  metadata: Record<string, unknown>;
  line_count: number;
  byte_size: number;
  level_counts: Record<string, number>;
  last_level?: string | null;
  last_message?: string | null;
  last_log_at?: string | null;
  is_truncated: boolean;
  created_at: string;
  closed_at?: string | null;
};

export type OperationLogEntry = {
  timestamp: string;
  level: "debug" | "info" | "warning" | "error" | "critical" | string;
  component: string;
  message: string;
  raw?: string | null;
  context?: Record<string, unknown> | null;
  exception?: Record<string, unknown> | null;
};

export type OperationLogStreamsPageResponse = PageResponse<OperationLogStream>;

export type OperationLogEntriesResponse = {
  stream: OperationLogStream;
  entries: OperationLogEntry[];
  next_cursor: number;
  available: boolean;
  is_truncated: boolean;
};

export type SourceDiscovery = {
  id: number;
  tweet_id: string;
  archive_run_id?: number | null;
  discovered_at?: string | null;
  download_status?: string | null;
  author_username?: string | null;
  text?: string | null;
  raw_payload?: {
    media_count?: number;
    media_types?: string[];
    has_photo?: boolean;
    has_video?: boolean;
  } | null;
  active_run_id?: number | null;
  active_item_id?: number | null;
  active_item_status?: string | null;
  active_run_status?: string | null;
  cancel_requested?: boolean | null;
  downloaded_bytes?: number | null;
  total_bytes?: number | null;
  speed_bps?: number | null;
  progress_message?: string | null;
  last_progress_at?: string | null;
  downloaded_media_count?: number | null;
  downloaded_media_bytes?: number | null;
};

type ArchiveSourceBase = {
  id: number;
  source_type: string;
  source_url?: string | null;
  label?: string | null;
  author_username?: string | null;
  status: "active" | "paused" | "completed" | "failed";
  is_pinned: boolean;
  discovered_count?: number | null;
  submitted_count?: number | null;
  discovered_tweet_count?: number | null;
  discovered_media_count?: number | null;
  unsubmitted_tweet_count?: number | null;
  scan_batch_count?: number | null;
  latest_discovered_at?: string | null;
  last_seen_tweet_id?: string | null;
  newest_seen_tweet_id?: string | null;
  oldest_seen_tweet_id?: string | null;
  error_category?: string | null;
  error_message?: string | null;
  next_scan_at?: string | null;
  cursor_state?: {
    next_start_index?: number;
    last_range_start?: number;
    last_range_end?: number;
    last_limit?: number;
    last_scan_url?: string | null;
    last_raw_record_count?: number;
    last_discovered_count?: number;
    last_new_discovered_count?: number;
    last_duplicate_count?: number;
    last_reached_known_region?: boolean;
    last_completed?: boolean;
    automation_enabled?: boolean;
    automation_state?: string;
    automation_limit?: number;
    active_scan_mode?: "history" | "latest_refresh" | "from_start" | string | null;
    scan_sessions?: Record<string, Record<string, unknown>>;
    extractor_cursor?: string | null;
  } | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ArchiveSourceListItem = ArchiveSourceBase;

export type ArchiveSourceDetail = ArchiveSourceBase & {
  scan_summary: {
    batch_count: number;
    added_tweet_count: number;
    last_success_at?: string | null;
    last_error_at?: string | null;
  };
  active_scan_run?: SourceScanRun | null;
};

export type ArchiveSource = ArchiveSourceDetail;

export type SourcePageResponse = PageResponse<ArchiveSourceListItem>;
export type SourceDiscoveryPageResponse = PageResponse<SourceDiscovery>;
export type SourceScanRunsPageResponse = PageResponse<SourceScanRun>;

export type SourceDownloadSummary = {
  source_id: number;
  active_run?: ArchiveRunDetail | null;
  active_counts: {
    total_count: number;
    settled_count: number;
    pending_count: number;
    blocked_count: number;
    processing_count: number;
    failed_retryable_count: number;
    verified_count: number;
    skipped_verified_count: number;
    linked_pending_count: number;
    failed_permanent_count: number;
    cancelled_count: number;
  };
  paused_runs: ArchiveRun[];
  blocked_runs: ArchiveRun[];
  recent_runs: ArchiveRun[];
  pending_count: number;
  blocked_count: number;
  processing_count: number;
  paused_count: number;
  failed_count: number;
  completed_count: number;
  cancelled_count: number;
  downloaded_bytes: number;
  total_bytes?: number | null;
  speed_bps?: number | null;
};

export type ArchiveRunControl = {
  run_id: number;
  status: string;
  affected_count: number;
};

export type DownloadPolicy = {
  queue_batch_size: number;
  downloader_sleep_min_seconds: number;
  downloader_sleep_max_seconds: number;
  downloader_progress_fallback_interval_seconds: number;
  default_download_engine: string;
  source_scan_batch_size: number;
  source_scan_sleep_min_seconds: number;
  source_scan_sleep_max_seconds: number;
  source_scan_http_timeout_seconds: number;
  source_scan_http_retries: number;
};

export type CookieConfig = {
  configured: boolean;
  source: "database" | "file" | "none";
  label?: string | null;
  updated_at?: string | null;
  validation_status: "unchecked" | "valid" | "invalid" | "expired" | "error";
  validated_at?: string | null;
  auth_token_expires_at?: string | null;
  validation_error_category?: string | null;
  validation_message?: string | null;
};

export type AuthSession = {
  status: "uninitialized" | "anonymous" | "authenticated";
  auth_mode: "password" | "disabled";
  user?: { username: string } | null;
};

export type HealthDetail = {
  status: string;
  worker: {
    stop_requested: boolean;
    write_lock_held: boolean;
  };
  db_pool: {
    active: number;
    idle: number;
    waiting: number;
    min_size: number;
    max_size: number;
  };
  queue: {
    pending_items: number;
    processing_items: number;
    retryable_failed_items: number;
    permanent_failed_items: number;
    queued_runs: number;
    running_runs: number;
    latest_run?: {
      id: number;
      trigger_type: string;
      status: string;
      started_at: string;
      finished_at?: string | null;
      error_message?: string | null;
    } | null;
  };
  sources: {
    active_sources: number;
    paused_sources: number;
    failed_sources: number;
    history_enabled_sources: number;
    active_scan_runs: number;
    latest_scan?: {
      id: number;
      source_id: number;
      trigger_type: string;
      status: string;
      requested_limit?: number | null;
      error_category?: string | null;
      error_message?: string | null;
      started_at?: string | null;
      finished_at?: string | null;
      created_at: string;
    } | null;
  };
  recent_errors: Array<{
    kind?: string | null;
    id?: string | null;
    subject?: string | null;
    archive_run_id?: number | null;
    archive_run_item_id?: number | null;
    tweet_id?: string | null;
    source_id?: number | null;
    source_scan_run_id?: number | null;
    target_path?: string | null;
    error_category?: string | null;
    error_message?: string | null;
    occurred_at?: string | null;
  }>;
};

export function mediaQueryString(params: Record<string, string>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return search.toString();
}
