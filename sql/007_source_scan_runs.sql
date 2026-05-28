create table if not exists source_scan_runs (
  id bigserial primary key,
  source_id bigint not null references archive_sources(id) on delete cascade,
  trigger_type text not null,
  status text not null,
  range_start int,
  range_end int,
  requested_limit int,
  cursor_before jsonb not null default '{}'::jsonb,
  cursor_after jsonb,
  discovered_tweet_count int not null default 0,
  new_tweet_count int not null default 0,
  duplicate_tweet_count int not null default 0,
  discovered_media_count int not null default 0,
  error_category text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint chk_source_scan_runs_trigger_type check (
    trigger_type in ('history_worker', 'manual_next', 'latest_refresh')
  ),
  constraint chk_source_scan_runs_status check (
    status in (
      'running',
      'waiting_downloads',
      'succeeded',
      'completed_empty_batch',
      'rate_limited',
      'auth_required',
      'network_error',
      'failed'
    )
  )
);

create index if not exists idx_source_scan_runs_source_created
on source_scan_runs(source_id, created_at desc, id desc);

create index if not exists idx_source_scan_runs_status
on source_scan_runs(status);
