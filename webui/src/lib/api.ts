export { ApiError, apiGet, apiPost, apiRequest, apiUrl } from "../api/client";

export type Summary = {
  tweet_status_counts: Record<string, number>;
  media_count: number;
  failure_count: number;
  archive_dir: string;
  exports: Array<{ name: string; path: string; size: number; modified_at: number }>;
};

export type MediaRow = {
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

export type DuplicatesResponse = PageResponse<MediaRow> & {
  duplicate_groups: number;
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

export type ArchiveRunTasks = {
  queued_count: number;
  skipped_verified_count: number;
  linked_pending_count: number;
  verified_count: number;
  failed_count: number;
};

export type ArchiveRun = {
  id: number;
  trigger_type: string;
  input_path?: string | null;
  status: "queued" | "running" | "completed" | "completed_with_failures" | "failed";
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
  run_id: number;
  source_id?: number;
  status: string;
  input: {
    input_record_count: number;
    unique_tweet_count: number;
    duplicate_input_count: number;
  };
  tasks: {
    queued_count: number;
    skipped_verified_count: number;
    linked_pending_count: number;
  };
};

export type SourceScanRun = {
  id: number;
  trigger_type: "history_worker" | "manual_next" | "latest_refresh";
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
  discovered_tweet_count: number;
  new_tweet_count: number;
  duplicate_tweet_count: number;
  discovered_media_count: number;
  error_category?: string | null;
  error_message?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
};

export type ArchiveSource = {
  id: number;
  source_type: string;
  source_url?: string | null;
  label?: string | null;
  author_username?: string | null;
  status: "active" | "paused" | "completed" | "failed";
  discovered_count?: number | null;
  submitted_count?: number | null;
  discovered_tweet_count?: number | null;
  discovered_media_count?: number | null;
  unsubmitted_tweet_count?: number | null;
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
    extractor_cursor?: string | null;
  } | null;
  created_at?: string | null;
  updated_at?: string | null;
  scan_summary?: {
    batch_count: number;
    added_tweet_count: number;
    last_success_at?: string | null;
    last_error_at?: string | null;
  };
  scan_runs?: SourceScanRun[];
  discovered?: Array<{
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
  }>;
};

export type SourcePageResponse = PageResponse<ArchiveSource>;

export type DownloadPolicy = {
  queue_batch_size: number;
  downloader_sleep_min_seconds: number;
  downloader_sleep_max_seconds: number;
  default_download_engine: string;
  source_scan_batch_size: number;
  source_scan_sleep_min_seconds: number;
  source_scan_sleep_max_seconds: number;
};

export type HealthDetail = {
  status: string;
  worker: {
    stop_requested?: boolean;
    write_lock_held?: boolean;
  };
  queue: {
    pending_items?: number;
    processing_items?: number;
    retryable_failed_items?: number;
    permanent_failed_items?: number;
    queued_runs?: number;
    running_runs?: number;
    latest_run?: Record<string, unknown> | null;
  };
  sources: {
    active_sources?: number;
    paused_sources?: number;
    failed_sources?: number;
    history_enabled_sources?: number;
    active_scan_runs?: number;
    latest_scan?: Record<string, unknown> | null;
  };
  recent_errors: Array<Record<string, unknown>>;
};

export function mediaQueryString(params: Record<string, string>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return search.toString();
}
