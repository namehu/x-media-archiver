from alembic import op

revision = "006_source_download_controls"
down_revision = "005_add_from_start_scan_trigger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table archive_runs
          add column if not exists source_id bigint references archive_sources(id) on delete set null,
          add column if not exists blocked_by_run_id bigint references archive_runs(id) on delete set null,
          add column if not exists control_state jsonb not null default '{}'::jsonb;

        alter table archive_runs
          drop constraint if exists chk_archive_runs_status;

        alter table archive_runs
          add constraint chk_archive_runs_status check (
            status in (
              'queued',
              'blocked',
              'running',
              'paused',
              'stopped',
              'completed',
              'completed_with_failures',
              'failed'
            )
          );

        create index if not exists idx_archive_runs_source_status
        on archive_runs(source_id, status, started_at);

        alter table archive_run_items
          add column if not exists cancel_requested boolean not null default false,
          add column if not exists downloaded_bytes bigint not null default 0,
          add column if not exists total_bytes bigint,
          add column if not exists speed_bps bigint,
          add column if not exists progress_message text,
          add column if not exists last_progress_at timestamptz;

        alter table archive_run_items
          drop constraint if exists chk_archive_run_items_status;

        alter table archive_run_items
          add constraint chk_archive_run_items_status check (
            status in (
              'pending',
              'blocked',
              'processing',
              'verified',
              'skipped_verified',
              'linked_pending',
              'failed_retryable',
              'failed_permanent',
              'cancelled'
            )
          );

        drop index if exists uq_archive_run_items_active_tweet;

        create unique index if not exists uq_archive_run_items_active_tweet
        on archive_run_items(tweet_id)
        where status in ('pending', 'blocked', 'processing', 'failed_retryable');

        alter table download_jobs
          add column if not exists current_tweet_id text,
          add column if not exists current_file text,
          add column if not exists downloaded_bytes bigint not null default 0,
          add column if not exists total_bytes bigint,
          add column if not exists speed_bps bigint,
          add column if not exists last_progress_at timestamptz;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        alter table download_jobs
          drop column if exists last_progress_at,
          drop column if exists speed_bps,
          drop column if exists total_bytes,
          drop column if exists downloaded_bytes,
          drop column if exists current_file,
          drop column if exists current_tweet_id;

        drop index if exists uq_archive_run_items_active_tweet;

        create unique index if not exists uq_archive_run_items_active_tweet
        on archive_run_items(tweet_id)
        where status in ('pending', 'processing', 'failed_retryable');

        alter table archive_run_items
          drop constraint if exists chk_archive_run_items_status;

        alter table archive_run_items
          add constraint chk_archive_run_items_status check (
            status in (
              'pending',
              'processing',
              'verified',
              'skipped_verified',
              'linked_pending',
              'failed_retryable',
              'failed_permanent'
            )
          );

        alter table archive_run_items
          drop column if exists last_progress_at,
          drop column if exists progress_message,
          drop column if exists speed_bps,
          drop column if exists total_bytes,
          drop column if exists downloaded_bytes,
          drop column if exists cancel_requested;

        drop index if exists idx_archive_runs_source_status;

        alter table archive_runs
          drop constraint if exists chk_archive_runs_status;

        alter table archive_runs
          add constraint chk_archive_runs_status check (
            status in (
              'queued',
              'running',
              'completed',
              'completed_with_failures',
              'failed'
            )
          );

        alter table archive_runs
          drop column if exists control_state,
          drop column if exists blocked_by_run_id,
          drop column if exists source_id;
        """
    )
