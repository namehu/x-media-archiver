"""add durable media preview jobs and scheduler settings

Revision ID: 025_add_media_preview_jobs
Revises: 024_add_media_privacy_mode
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "025_add_media_preview_jobs"
down_revision = "024_add_media_privacy_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "media_preview_scheduler_settings",
        sa.Column("id", sa.SmallInteger(), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("frequency_kind", sa.Text(), nullable=False, server_default="daily"),
        sa.Column("interval_minutes", sa.Integer(), nullable=False, server_default="1440"),
        sa.Column("local_time", sa.Time(), nullable=False, server_default="03:30:00"),
        sa.Column("weekday", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("timezone", sa.Text(), nullable=False, server_default="Asia/Shanghai"),
        sa.Column("jitter_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_run_at", sa.DateTime(timezone=True)),
        sa.Column("last_run_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("id = 1", name="ck_media_preview_scheduler_singleton"),
        sa.CheckConstraint(
            "frequency_kind in ('interval', 'daily', 'weekly')",
            name="ck_media_preview_scheduler_frequency_kind",
        ),
        sa.CheckConstraint("interval_minutes >= 60", name="ck_media_preview_scheduler_interval"),
        sa.CheckConstraint("weekday between 0 and 6", name="ck_media_preview_scheduler_weekday"),
        sa.CheckConstraint("jitter_seconds >= 0", name="ck_media_preview_scheduler_jitter"),
    )
    op.execute(
        sa.text(
            """
            insert into media_preview_scheduler_settings (id)
            values (1)
            on conflict (id) do nothing
            """
        )
    )

    op.create_table(
        "media_preview_jobs",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("trigger_type", sa.Text(), nullable=False),
        sa.Column("mode", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="queued"),
        sa.Column(
            "schedule_id",
            sa.SmallInteger(),
            sa.ForeignKey("media_preview_scheduler_settings.id", ondelete="SET NULL"),
        ),
        sa.Column("snapshot_max_media_id", sa.BigInteger()),
        sa.Column("cursor_after_media_id", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("total_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("scanned_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("generated_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("existing_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("worker_id", sa.Text()),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True)),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True)),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("options", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text())),
        sa.Column("error_message", sa.Text()),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "trigger_type in ('manual', 'scheduled', 'retry')",
            name="ck_media_preview_jobs_trigger_type",
        ),
        sa.CheckConstraint("mode in ('reconcile', 'force')", name="ck_media_preview_jobs_mode"),
        sa.CheckConstraint(
            "status in ('queued', 'running', 'completed', 'completed_with_failures', 'failed', 'cancelled')",
            name="ck_media_preview_jobs_status",
        ),
    )
    op.create_index(
        "uq_media_preview_jobs_active",
        "media_preview_jobs",
        [sa.text("(true)")],
        unique=True,
        postgresql_where=sa.text("status in ('queued', 'running')"),
    )
    op.create_index(
        "ix_media_preview_jobs_claim",
        "media_preview_jobs",
        ["status", "next_attempt_at", "created_at"],
    )
    op.create_index(
        "ix_media_preview_jobs_history",
        "media_preview_jobs",
        [sa.text("created_at desc"), sa.text("id desc")],
    )


def downgrade() -> None:
    op.drop_index("ix_media_preview_jobs_history", table_name="media_preview_jobs")
    op.drop_index("ix_media_preview_jobs_claim", table_name="media_preview_jobs")
    op.drop_index("uq_media_preview_jobs_active", table_name="media_preview_jobs")
    op.drop_table("media_preview_jobs")
    op.drop_table("media_preview_scheduler_settings")
