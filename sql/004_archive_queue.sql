alter table archive_runs
drop constraint if exists chk_archive_runs_status;

alter table archive_runs
add constraint chk_archive_runs_status check (
  status in ('queued', 'running', 'completed', 'completed_with_failures', 'failed')
);

create table if not exists archive_run_items (
  id bigserial primary key,
  archive_run_id bigint not null references archive_runs(id) on delete cascade,
  tweet_id text not null references tweets(tweet_id) on delete cascade,
  input_payload jsonb not null,
  status text not null default 'pending',
  retry_count int not null default 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  error_category text,
  error_message text,
  linked_item_id bigint references archive_run_items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_archive_run_items_run_tweet unique (archive_run_id, tweet_id),
  constraint chk_archive_run_items_status check (
    status in (
      'pending',
      'processing',
      'verified',
      'skipped_verified',
      'linked_pending',
      'failed_retryable',
      'failed_permanent'
    )
  )
);

create index if not exists idx_archive_run_items_run_id
on archive_run_items(archive_run_id);

create index if not exists idx_archive_run_items_status_due
on archive_run_items(status, next_attempt_at, created_at);

create unique index if not exists uq_archive_run_items_active_tweet
on archive_run_items(tweet_id)
where status in ('pending', 'processing');

alter table download_jobs
add column if not exists archive_run_id bigint references archive_runs(id) on delete set null;

create index if not exists idx_download_jobs_archive_run_id
on download_jobs(archive_run_id);

alter table download_attempts
add column if not exists archive_run_item_id bigint references archive_run_items(id) on delete set null;

create index if not exists idx_download_attempts_archive_run_item_id
on download_attempts(archive_run_item_id);
