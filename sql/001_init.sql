create table if not exists archive_sources (
  id bigserial primary key,
  source_type text not null,
  source_url text,
  label text,
  created_at timestamptz not null default now()
);

create index if not exists idx_archive_sources_source_type
on archive_sources(source_type);

create table if not exists tweets (
  tweet_id text primary key,
  url text not null,
  author_username text,
  author_display_name text,
  published_at timestamptz,
  text text,
  source_type text,
  source_url text,
  collected_at timestamptz,
  imported_at timestamptz not null default now(),
  download_status text not null default 'pending',
  raw_import jsonb,
  last_error text,
  retry_count int not null default 0,
  last_attempt_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint chk_tweets_download_status check (
    download_status in (
      'pending',
      'downloading',
      'downloaded',
      'partial',
      'failed_retryable',
      'failed_permanent',
      'verified',
      'missing',
      'corrupt',
      'skipped'
    )
  )
);

create index if not exists idx_tweets_author_username
on tweets(author_username);

create index if not exists idx_tweets_download_status
on tweets(download_status);

create index if not exists idx_tweets_published_at
on tweets(published_at);

create table if not exists media_assets (
  id bigserial primary key,
  tweet_id text not null references tweets(tweet_id) on delete cascade,
  media_index int,
  media_type text,
  local_path text,
  original_filename text,
  file_ext text,
  file_size bigint,
  sha256 text,
  width int,
  height int,
  duration_ms int,
  source_engine text,
  metadata_path text,
  download_status text not null default 'pending',
  error_message text,
  raw_metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_media_assets_download_status check (
    download_status in (
      'pending',
      'downloading',
      'downloaded',
      'failed_retryable',
      'failed_permanent',
      'verified',
      'missing',
      'corrupt',
      'skipped'
    )
  )
);

create unique index if not exists uq_media_assets_tweet_index_engine
on media_assets(tweet_id, media_index, source_engine)
where media_index is not null and source_engine is not null;

create unique index if not exists uq_media_assets_local_path
on media_assets(local_path)
where local_path is not null;

create index if not exists idx_media_assets_tweet_id
on media_assets(tweet_id);

create index if not exists idx_media_assets_status
on media_assets(download_status);

create index if not exists idx_media_assets_sha256
on media_assets(sha256);

create index if not exists idx_media_assets_source_engine
on media_assets(source_engine);

create table if not exists download_jobs (
  id bigserial primary key,
  job_type text not null,
  engine text,
  input_path text,
  status text not null default 'pending',
  total_count int not null default 0,
  success_count int not null default 0,
  failed_count int not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_download_jobs_status
on download_jobs(status);

create index if not exists idx_download_jobs_engine
on download_jobs(engine);

create table if not exists download_attempts (
  id bigserial primary key,
  job_id bigint references download_jobs(id) on delete set null,
  tweet_id text references tweets(tweet_id) on delete cascade,
  media_asset_id bigint references media_assets(id) on delete set null,
  engine text not null,
  status text not null,
  exit_code int,
  error_category text,
  error_message text,
  stderr_excerpt text,
  duration_ms int,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_download_attempts_tweet_id
on download_attempts(tweet_id);

create index if not exists idx_download_attempts_job_id
on download_attempts(job_id);

create index if not exists idx_download_attempts_engine
on download_attempts(engine);

