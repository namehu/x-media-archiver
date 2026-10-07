"""Separate legacy media source identities and audit explicit source splits."""

import sqlalchemy as sa
from alembic import op

revision = "027_split_media_sources"
down_revision = "026_unify_cross_engine_media"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("uq_archive_sources_source_url", table_name="archive_sources")
    op.create_index(
        "uq_archive_sources_legacy_url",
        "archive_sources",
        ["source_url"],
        unique=True,
        postgresql_where=sa.text("source_url IS NOT NULL AND source_type = 'user_media'"),
    )
    op.create_index(
        "uq_archive_sources_current_url",
        "archive_sources",
        ["source_url"],
        unique=True,
        postgresql_where=sa.text("source_url IS NOT NULL AND source_type <> 'user_media'"),
    )
    op.create_table(
        "source_media_splits",
        sa.Column(
            "old_source_id",
            sa.BigInteger(),
            sa.ForeignKey("archive_sources.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
        sa.Column(
            "photos_source_id",
            sa.BigInteger(),
            sa.ForeignKey("archive_sources.id", ondelete="RESTRICT"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "videos_source_id",
            sa.BigInteger(),
            sa.ForeignKey("archive_sources.id", ondelete="RESTRICT"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "old_source_id <> photos_source_id AND old_source_id <> videos_source_id AND photos_source_id <> videos_source_id",
            name="ck_source_media_splits_distinct_ids",
        ),
    )


def downgrade() -> None:
    # A split retains old/new sources with the same URL; a blind downgrade would
    # erase its audit mapping and cannot restore the previous uniqueness contract.
    if op.get_bind().execute(sa.text("SELECT EXISTS (SELECT 1 FROM source_media_splits)")).scalar():
        raise RuntimeError(
            "media_source_splits_exist: restore the pre-split backup before downgrading"
        )
    op.create_index(
        "uq_archive_sources_source_url",
        "archive_sources",
        ["source_url"],
        unique=True,
        postgresql_where=sa.text("source_url IS NOT NULL"),
    )
    op.drop_table("source_media_splits")
    op.drop_index("uq_archive_sources_current_url", table_name="archive_sources")
    op.drop_index("uq_archive_sources_legacy_url", table_name="archive_sources")
