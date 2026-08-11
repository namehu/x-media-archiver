"""add failure triage state and audit events

Revision ID: 018_add_failure_triage
Revises: 017_add_source_bulk_tasks
"""

from alembic import op

revision = "018_add_failure_triage"
down_revision = "017_add_source_bulk_tasks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The trigger keeps the current disposition aligned with every writer that
    # changes tweet status; SQLAlchemy Core cannot express PostgreSQL triggers.
    op.execute(
        """
        create table if not exists failure_dispositions (
          tweet_id text primary key references tweets(tweet_id) on delete cascade,
          reason text,
          note text,
          ignored_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          constraint chk_failure_dispositions_reason check (
            reason is null or reason in ('not_needed', 'unavailable', 'unsupported', 'duplicate', 'other')
          ),
          constraint chk_failure_dispositions_note_length check (
            note is null or char_length(note) <= 500
          )
        );

        create index if not exists idx_failure_dispositions_ignored_at
        on failure_dispositions(ignored_at desc, tweet_id);

        create table if not exists failure_action_events (
          id bigserial primary key,
          tweet_id text not null references tweets(tweet_id) on delete cascade,
          action text not null,
          previous_status text not null,
          reason text,
          note text,
          archive_run_id bigint references archive_runs(id) on delete set null,
          result jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now(),
          constraint chk_failure_action_events_action check (
            action in ('ignore', 'restore', 'retry')
          ),
          constraint chk_failure_action_events_reason check (
            reason is null or reason in ('not_needed', 'unavailable', 'unsupported', 'duplicate', 'other')
          ),
          constraint chk_failure_action_events_note_length check (
            note is null or char_length(note) <= 500
          )
        );

        create index if not exists idx_failure_action_events_tweet_created
        on failure_action_events(tweet_id, created_at desc, id desc);

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
              'skipped_ignored',
              'linked_pending',
              'failed_retryable',
              'failed_permanent',
              'cancelled'
            )
          );

        create or replace function xma_clear_failure_disposition_on_status_change()
        returns trigger
        language plpgsql
        as $$
        begin
          if old.download_status in ('failed_retryable', 'failed_permanent', 'corrupt')
             and new.download_status not in ('failed_retryable', 'failed_permanent', 'corrupt') then
            delete from failure_dispositions where tweet_id = new.tweet_id;
          end if;
          return new;
        end;
        $$;

        drop trigger if exists trg_tweets_clear_failure_disposition on tweets;
        create trigger trg_tweets_clear_failure_disposition
        after update of download_status on tweets
        for each row
        when (old.download_status is distinct from new.download_status)
        execute function xma_clear_failure_disposition_on_status_change();
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop trigger if exists trg_tweets_clear_failure_disposition on tweets;
        drop function if exists xma_clear_failure_disposition_on_status_change();

        update archive_run_items
        set status = 'cancelled', updated_at = now()
        where status = 'skipped_ignored';

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

        drop table if exists failure_action_events;
        drop table if exists failure_dispositions;
        """
    )
