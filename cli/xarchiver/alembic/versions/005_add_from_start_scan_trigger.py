from alembic import op

revision = "005_add_from_start_scan_trigger"
down_revision = "004_ensure_operation_log_streams"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table source_scan_runs
          drop constraint if exists chk_source_scan_runs_trigger_type;

        alter table source_scan_runs
          add constraint chk_source_scan_runs_trigger_type check (
            trigger_type in ('history_worker', 'manual_next', 'latest_refresh', 'from_start_repair')
          );
        """
    )


def downgrade() -> None:
    op.execute(
        """
        alter table source_scan_runs
          drop constraint if exists chk_source_scan_runs_trigger_type;

        alter table source_scan_runs
          add constraint chk_source_scan_runs_trigger_type check (
            trigger_type in ('history_worker', 'manual_next', 'latest_refresh')
          );
        """
    )
