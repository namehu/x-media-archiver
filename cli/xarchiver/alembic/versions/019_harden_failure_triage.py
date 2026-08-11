"""harden failure triage lifecycle

Revision ID: 019_harden_failure_triage
Revises: 018_add_failure_triage
"""

from alembic import op

revision = "019_harden_failure_triage"
down_revision = "018_add_failure_triage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PostgreSQL triggers are used so success cleanup remains correct for every
    # downloader/verifier writer, including processes outside the API worker.
    op.execute(
        """
        alter table failure_action_events
          drop constraint if exists chk_failure_action_events_action;

        alter table failure_action_events
          add constraint chk_failure_action_events_action check (
            action in ('ignore', 'restore', 'retry', 'resolved')
          );

        create or replace function xma_clear_failure_disposition_on_status_change()
        returns trigger
        language plpgsql
        as $$
        begin
          if new.download_status in ('downloaded', 'verified') then
            insert into failure_action_events (
              tweet_id, action, previous_status, reason, note, result, created_at
            )
            select d.tweet_id,
                   'resolved',
                   old.download_status,
                   d.reason,
                   d.note,
                   jsonb_build_object('new_status', new.download_status),
                   now()
            from failure_dispositions d
            where d.tweet_id = new.tweet_id;

            delete from failure_dispositions where tweet_id = new.tweet_id;
          end if;
          return new;
        end;
        $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        delete from failure_dispositions d
        using tweets t
        where t.tweet_id = d.tweet_id
          and t.download_status not in ('failed_retryable', 'failed_permanent', 'corrupt');

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

        alter table failure_action_events
          drop constraint if exists chk_failure_action_events_action;

        update failure_action_events
        set action = 'restore',
            result = result || '{"downgraded_from":"resolved"}'::jsonb
        where action = 'resolved';

        alter table failure_action_events
          add constraint chk_failure_action_events_action check (
            action in ('ignore', 'restore', 'retry')
          );
        """
    )
