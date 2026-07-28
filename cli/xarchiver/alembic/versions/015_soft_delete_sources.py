"""soft delete archive sources

Revision ID: 015_soft_delete_sources
Revises: 014_unique_source_urls
"""

from alembic import op

revision = "015_soft_delete_sources"
down_revision = "014_unique_source_urls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table archive_sources
          add column if not exists deleted_at timestamptz;

        create index if not exists idx_archive_sources_active_updated
        on archive_sources (is_pinned desc, updated_at desc, id desc)
        where deleted_at is null;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop index if exists idx_archive_sources_active_updated;

        alter table archive_sources
          drop column if exists deleted_at;
        """
    )
