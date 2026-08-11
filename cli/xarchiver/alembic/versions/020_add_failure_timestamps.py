"""add stable failure timestamps

Revision ID: 020_add_failure_timestamps
Revises: 019_harden_failure_triage
"""

from alembic import op

revision = "020_add_failure_timestamps"
down_revision = "019_harden_failure_triage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Dedicated timestamps keep failure ordering independent from metadata,
    # progress, cancellation, and disposition updates to generic updated_at.
    op.execute(
        """
        alter table tweets
          add column if not exists failure_at timestamptz;

        alter table archive_run_items
          add column if not exists failure_at timestamptz;

        update archive_run_items
        set failure_at = coalesce(last_attempt_at, created_at, updated_at)
        where failure_at is null
          and (
            status in ('failed_retryable', 'failed_permanent')
            or error_category is not null
          );

        update tweets t
        set failure_at = coalesce(
          greatest(
            t.last_attempt_at,
            (
              select max(a.finished_at)
              from download_attempts a
              where a.tweet_id = t.tweet_id
            ),
            (
              select max(i.failure_at)
              from archive_run_items i
              where i.tweet_id = t.tweet_id
            )
          ),
          t.updated_at
        )
        where t.failure_at is null
          and t.download_status in ('failed_retryable', 'failed_permanent', 'corrupt');

        create or replace function xma_set_tweet_failure_at()
        returns trigger
        language plpgsql
        as $$
        begin
          if tg_op = 'INSERT' then
            if new.download_status in ('failed_retryable', 'failed_permanent', 'corrupt')
               and new.failure_at is null then
              new.failure_at = now();
            end if;
          elsif new.download_status in ('failed_retryable', 'failed_permanent', 'corrupt')
                and old.download_status is distinct from new.download_status
                and new.failure_at is not distinct from old.failure_at then
            new.failure_at = now();
          end if;
          return new;
        end;
        $$;

        drop trigger if exists trg_tweets_set_failure_at on tweets;
        create trigger trg_tweets_set_failure_at
        before insert or update of download_status on tweets
        for each row
        execute function xma_set_tweet_failure_at();

        create or replace function xma_set_archive_run_item_failure_at()
        returns trigger
        language plpgsql
        as $$
        begin
          if tg_op = 'INSERT' then
            if (
              new.status in ('failed_retryable', 'failed_permanent')
              or new.error_category is not null
            ) and new.failure_at is null then
              new.failure_at = now();
            end if;
          elsif (
            (
              new.status in ('failed_retryable', 'failed_permanent')
              and old.status is distinct from new.status
            )
            or new.error_category is distinct from old.error_category
          ) and new.failure_at is not distinct from old.failure_at then
            new.failure_at = now();
          end if;
          return new;
        end;
        $$;

        drop trigger if exists trg_archive_run_items_set_failure_at on archive_run_items;
        create trigger trg_archive_run_items_set_failure_at
        before insert or update of status, error_category on archive_run_items
        for each row
        execute function xma_set_archive_run_item_failure_at();

        create index if not exists idx_tweets_failure_at
        on tweets(failure_at desc, tweet_id)
        where download_status in ('failed_retryable', 'failed_permanent', 'corrupt');
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop index if exists idx_tweets_failure_at;

        drop trigger if exists trg_archive_run_items_set_failure_at on archive_run_items;
        drop function if exists xma_set_archive_run_item_failure_at();

        drop trigger if exists trg_tweets_set_failure_at on tweets;
        drop function if exists xma_set_tweet_failure_at();

        alter table archive_run_items drop column if exists failure_at;
        alter table tweets drop column if exists failure_at;
        """
    )
