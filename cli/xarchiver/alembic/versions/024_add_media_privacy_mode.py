"""persist account-level media privacy preferences

Revision ID: 024_add_media_privacy_mode
Revises: 023_add_platform_hashtags
"""

import sqlalchemy as sa
from alembic import op

revision = "024_add_media_privacy_mode"
down_revision = "023_add_platform_hashtags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "auth_admin",
        sa.Column(
            "media_privacy_mode",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("auth_admin", "media_privacy_mode")
