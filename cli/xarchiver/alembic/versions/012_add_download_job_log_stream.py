"""add download job log stream

Revision ID: 012_add_download_job_log_stream
Revises: 011_add_media_delete_audit
"""

from alembic import op

revision = "012_add_download_job_log_stream"
down_revision = "011_add_media_delete_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table download_jobs
          add column if not exists log_stream_id bigint references operation_log_streams(id);

        create index if not exists idx_download_jobs_log_stream
        on download_jobs(log_stream_id);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop index if exists idx_download_jobs_log_stream;
        alter table download_jobs drop column if exists log_stream_id;
        """
    )
