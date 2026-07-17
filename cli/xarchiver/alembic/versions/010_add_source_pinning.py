from alembic import op

revision = "010_add_source_pinning"
down_revision = "009_add_cookie_validation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table archive_sources
          add column if not exists is_pinned boolean not null default false;

        create index if not exists idx_archive_sources_pinned_updated
          on archive_sources (is_pinned desc, updated_at desc, id desc);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop index if exists idx_archive_sources_pinned_updated;
        alter table archive_sources drop column if exists is_pinned;
        """
    )
