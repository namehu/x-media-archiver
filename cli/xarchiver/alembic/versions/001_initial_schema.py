from alembic import op

revision = "001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create table if not exists archive_sources (
          id bigserial primary key,
          source_type text not null,
          source_url text,
          label text,
          author_username text,
          status text not null default 'active',
          cursor_state jsonb not null default '{}'::jsonb,
          last_seen_tweet_id text,
          newest_seen_tweet_id text,
          oldest_seen_tweet_id text,
          discovered_count int not null default 0,
          submitted_count int not null default 0,
          error_category text,
          error_message text,
          last_scan_at timestamptz,
          next_scan_at timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          constraint chk_archive_sources_status check (
            status in ('active', 'paused', 'completed', 'failed')
          )
        );

        create index if not exists idx_archive_sources_source_type
        on archive_sources(source_type);

        create index if not exists idx_archive_sources_status
        on archive_sources(status);

        create index if not exists idx_archive_sources_author_username
        on archive_sources(author_username);

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

        create table if not exists archive_runs (
          id bigserial primary key,
          trigger_type text not null,
          input_path text,
          status text not null default 'running',
          started_at timestamptz not null default now(),
          finished_at timestamptz,
          result jsonb,
          error_message text,
          constraint chk_archive_runs_status check (
            status in (
              'queued',
              'running',
              'completed',
              'completed_with_failures',
              'failed'
            )
          )
        );

        create index if not exists idx_archive_runs_status
        on archive_runs(status);

        create index if not exists idx_archive_runs_started_at
        on archive_runs(started_at desc);

        create table if not exists inbox_imports (
          id bigserial primary key,
          file_path text not null,
          filename text not null,
          file_type text not null,
          file_size bigint not null,
          sha256 text not null unique,
          status text not null default 'pending',
          discovered_at timestamptz not null default now(),
          processing_started_at timestamptz,
          processed_at timestamptz,
          error_message text,
          result jsonb,
          archive_run_id bigint references archive_runs(id) on delete set null,
          constraint chk_inbox_imports_file_type check (file_type in ('urls', 'jsonl')),
          constraint chk_inbox_imports_status check (
            status in ('pending', 'processing', 'completed', 'failed')
          )
        );

        create index if not exists idx_inbox_imports_status
        on inbox_imports(status);

        create index if not exists idx_inbox_imports_discovered_at
        on inbox_imports(discovered_at desc);

        create index if not exists idx_inbox_imports_archive_run_id
        on inbox_imports(archive_run_id);

        create table if not exists inbox_scheduler_settings (
          id smallint primary key default 1,
          enabled boolean not null default false,
          interval_minutes int not null default 15,
          last_scan_at timestamptz,
          next_scan_at timestamptz,
          updated_at timestamptz not null default now(),
          constraint chk_inbox_scheduler_singleton check (id = 1),
          constraint chk_inbox_scheduler_interval check (interval_minutes >= 1)
        );

        insert into inbox_scheduler_settings (id, enabled, interval_minutes)
        values (1, false, 15)
        on conflict (id) do nothing;

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
          worker_id text,
          lease_expires_at timestamptz,
          claimed_at timestamptz,
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
        where status in ('pending', 'processing', 'failed_retryable');

        create unique index if not exists archive_run_items_running_uniq
        on archive_run_items(id)
        where status = 'processing';

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
          archive_run_id bigint references archive_runs(id) on delete set null,
          created_at timestamptz not null default now()
        );

        create index if not exists idx_download_jobs_status
        on download_jobs(status);

        create index if not exists idx_download_jobs_engine
        on download_jobs(engine);

        create index if not exists idx_download_jobs_archive_run_id
        on download_jobs(archive_run_id);

        create table if not exists download_attempts (
          id bigserial primary key,
          job_id bigint references download_jobs(id) on delete set null,
          tweet_id text references tweets(tweet_id) on delete cascade,
          media_asset_id bigint references media_assets(id) on delete set null,
          archive_run_item_id bigint references archive_run_items(id) on delete set null,
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

        create index if not exists idx_download_attempts_archive_run_item_id
        on download_attempts(archive_run_item_id);

        create table if not exists source_discovered_tweets (
          id bigserial primary key,
          source_id bigint not null references archive_sources(id) on delete cascade,
          tweet_id text not null references tweets(tweet_id) on delete cascade,
          archive_run_id bigint references archive_runs(id) on delete set null,
          discovered_at timestamptz not null default now(),
          raw_payload jsonb,
          constraint uq_source_discovered_tweets_source_tweet unique (source_id, tweet_id)
        );

        create index if not exists idx_source_discovered_tweets_source_id
        on source_discovered_tweets(source_id);

        create index if not exists idx_source_discovered_tweets_tweet_id
        on source_discovered_tweets(tweet_id);

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
          worker_id text,
          lease_expires_at timestamptz,
          claimed_at timestamptz,
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
              'completed_end_of_source',
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

        create unique index if not exists source_scan_runs_running_uniq
        on source_scan_runs(source_id)
        where status = 'running';
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop table if exists source_scan_runs cascade;
        drop table if exists source_discovered_tweets cascade;
        drop table if exists download_attempts cascade;
        drop table if exists download_jobs cascade;
        drop table if exists media_assets cascade;
        drop table if exists archive_run_items cascade;
        drop table if exists inbox_scheduler_settings cascade;
        drop table if exists inbox_imports cascade;
        drop table if exists archive_runs cascade;
        drop table if exists tweets cascade;
        drop table if exists archive_sources cascade;
        """
    )
