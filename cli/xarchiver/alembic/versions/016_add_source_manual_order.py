"""add manual ordering for archive sources

Revision ID: 016_add_source_manual_order
Revises: 015_soft_delete_sources
"""

from alembic import op

revision = "016_add_source_manual_order"
down_revision = "015_soft_delete_sources"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table archive_sources
          add column if not exists manual_order integer not null default 0;

        create index if not exists idx_archive_sources_active_manual_order
        on archive_sources (is_pinned desc, manual_order asc, created_at desc, id desc)
        where deleted_at is null;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop index if exists idx_archive_sources_active_manual_order;

        alter table archive_sources
          drop column if exists manual_order;
        """
    )
