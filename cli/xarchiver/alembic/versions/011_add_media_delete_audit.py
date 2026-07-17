"""add media delete audit

Revision ID: 011_add_media_delete_audit
Revises: 010_add_source_pinning
"""

from alembic import op

revision = "011_add_media_delete_audit"
down_revision = "010_add_source_pinning"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create table if not exists media_delete_operations (
          operation_id uuid primary key,
          requested_media_ids jsonb not null,
          tweet_ids jsonb not null default '[]'::jsonb,
          status text not null,
          result jsonb,
          error_message text,
          created_at timestamptz not null default now(),
          completed_at timestamptz,
          constraint chk_media_delete_operations_status check (
            status in ('running', 'completed', 'failed')
          )
        );

        create index if not exists idx_media_delete_operations_created_at
        on media_delete_operations(created_at desc);
        """
    )


def downgrade() -> None:
    op.execute("drop table if exists media_delete_operations")
