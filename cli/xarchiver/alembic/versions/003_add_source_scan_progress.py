from alembic import op

revision = "003_add_source_scan_progress"
down_revision = "002_add_cookie_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table source_scan_runs
          add column if not exists progress_message text,
          add column if not exists log_tail text,
          add column if not exists last_log_at timestamptz;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        alter table source_scan_runs
          drop column if exists last_log_at,
          drop column if exists log_tail,
          drop column if exists progress_message;
        """
    )
