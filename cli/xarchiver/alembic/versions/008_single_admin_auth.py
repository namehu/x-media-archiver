import sqlalchemy as sa
from alembic import op

revision = "008_single_admin_auth"
down_revision = "007_download_job_progress"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "auth_admin",
        sa.Column("id", sa.SmallInteger(), primary_key=True),
        sa.Column("username", sa.Text(), nullable=False, unique=True),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("id = 1", name="ck_auth_admin_singleton"),
        sa.CheckConstraint("username ~ '^[A-Za-z0-9._-]{3,64}$'", name="ck_auth_admin_username"),
    )
    op.create_table(
        "auth_sessions",
        sa.Column("token_hash", sa.Text(), primary_key=True),
        sa.Column("admin_id", sa.SmallInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["admin_id"], ["auth_admin.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_auth_sessions_expires_at", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_table("auth_admin")
