from alembic import op

revision = "007_download_job_progress"
down_revision = "006_source_download_controls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table download_jobs
          add column if not exists progress_message text;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        alter table download_jobs
          drop column if exists progress_message;
        """
    )
