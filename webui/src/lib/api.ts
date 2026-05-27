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

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

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

export type ArchiveSubmission = {
  run_id: number;
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

export function mediaQueryString(params: Record<string, string>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return search.toString();
}
