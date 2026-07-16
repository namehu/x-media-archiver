from alembic import op

revision = "009_add_cookie_validation"
down_revision = "008_single_admin_auth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table cookie_config
          add column if not exists validation_status text not null default 'unchecked',
          add column if not exists validated_at timestamptz,
          add column if not exists auth_token_expires_at timestamptz,
          add column if not exists validation_error_category text,
          add column if not exists validation_message text,
          add column if not exists validated_content_sha256 text;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        alter table cookie_config
          drop column if exists validated_content_sha256,
          drop column if exists validation_message,
          drop column if exists validation_error_category,
          drop column if exists auth_token_expires_at,
          drop column if exists validated_at,
          drop column if exists validation_status;
        """
    )
