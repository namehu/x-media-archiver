"""unify media identity across download engines

Revision ID: 026_unify_cross_engine_media
Revises: 025_add_media_preview_jobs
"""

import sqlalchemy as sa
from alembic import op

revision = "026_unify_cross_engine_media"
down_revision = "025_add_media_preview_jobs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A Tweet media position is one logical asset. Preserve the best indexed row
    # and its foreign-key references; physical fallback files remain untouched.
    op.execute(
        sa.text(
            """
            create temporary table media_asset_engine_duplicates on commit drop as
            with ranked as (
              select
                id,
                first_value(id) over (
                  partition by tweet_id, media_index
                  order by
                    case download_status
                      when 'verified' then 0
                      when 'downloaded' then 1
                      when 'downloading' then 2
                      when 'pending' then 3
                      when 'failed_retryable' then 4
                      when 'failed_permanent' then 5
                      when 'missing' then 6
                      when 'corrupt' then 7
                      when 'skipped' then 8
                      else 9
                    end,
                    case source_engine when 'gallery-dl' then 0 when 'yt-dlp' then 1 else 2 end,
                    id
                ) as keeper_id,
                row_number() over (
                  partition by tweet_id, media_index
                  order by
                    case download_status
                      when 'verified' then 0
                      when 'downloaded' then 1
                      when 'downloading' then 2
                      when 'pending' then 3
                      when 'failed_retryable' then 4
                      when 'failed_permanent' then 5
                      when 'missing' then 6
                      when 'corrupt' then 7
                      when 'skipped' then 8
                      else 9
                    end,
                    case source_engine when 'gallery-dl' then 0 when 'yt-dlp' then 1 else 2 end,
                    id
                ) as preference_rank
              from media_assets
              where media_index is not null
            )
            select id as duplicate_id, keeper_id
            from ranked
            where preference_rank > 1;

            update collections c
            set cover_media_id = d.keeper_id
            from media_asset_engine_duplicates d
            where c.cover_media_id = d.duplicate_id;

            update download_attempts a
            set media_asset_id = d.keeper_id
            from media_asset_engine_duplicates d
            where a.media_asset_id = d.duplicate_id;

            delete from media_assets m
            using media_asset_engine_duplicates d
            where m.id = d.duplicate_id;

            drop index if exists uq_media_assets_tweet_index_engine;
            create unique index uq_media_assets_tweet_index
            on media_assets(tweet_id, media_index)
            where media_index is not null;
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            drop index if exists uq_media_assets_tweet_index;
            create unique index uq_media_assets_tweet_index_engine
            on media_assets(tweet_id, media_index, source_engine)
            where media_index is not null and source_engine is not null;
            """
        )
    )
