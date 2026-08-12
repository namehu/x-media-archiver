"""add organization action audit log

Revision ID: 022_add_organization_audit
Revises: 021_add_tweet_search
"""

from alembic import op

revision = "022_add_organization_audit"
down_revision = "021_add_tweet_search"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create table if not exists organization_action_events (
          id bigserial primary key,
          action text not null,
          target_type text not null,
          target_id text,
          tweet_ids jsonb not null default '[]'::jsonb,
          details jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now(),
          constraint chk_organization_action check (
            action in (
              'tag_created', 'tag_updated', 'tag_deleted',
              'collection_created', 'collection_updated', 'collection_deleted',
              'tweet_labels_updated', 'tweet_note_updated', 'bulk_labels_updated'
            )
          ),
          constraint chk_organization_target_type check (
            target_type in ('tag', 'collection', 'tweet', 'tweet_selection')
          )
        );

        create index if not exists idx_organization_action_events_created
        on organization_action_events(created_at desc, id desc);
        """
    )


def downgrade() -> None:
    op.execute("drop table if exists organization_action_events;")
