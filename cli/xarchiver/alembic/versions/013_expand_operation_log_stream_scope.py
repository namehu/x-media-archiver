"""expand operation log stream scope

Revision ID: 013_expand_log_scope
Revises: 012_add_download_job_log_stream
"""

from alembic import op

revision = "013_expand_log_scope"
down_revision = "012_add_download_job_log_stream"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table operation_log_streams
          drop constraint if exists chk_operation_log_streams_scope_type;

        alter table operation_log_streams
          add constraint chk_operation_log_streams_scope_type
          check (scope_type in ('source_scan', 'download_job'));
        """
    )


def downgrade() -> None:
    op.execute(
        """
        alter table operation_log_streams
          drop constraint if exists chk_operation_log_streams_scope_type;

        alter table operation_log_streams
          add constraint chk_operation_log_streams_scope_type
          check (scope_type in ('source_scan'));
        """
    )
