"""add platform hashtags and additive metadata backfill audit

Revision ID: 023_add_platform_hashtags
Revises: 022_add_organization_audit
"""

from alembic import op

revision = "023_add_platform_hashtags"
down_revision = "022_add_organization_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Cross-table search refresh functions and operation-log scope constraints
    # intentionally use PostgreSQL DDL that SQLAlchemy Core cannot express well.
    op.execute(
        """
        create table hashtags (
          id bigserial primary key,
          name text not null,
          normalized_name text not null,
          created_at timestamptz not null default now(),
          constraint chk_hashtags_name_not_blank check (btrim(name) <> ''),
          constraint chk_hashtags_name_length check (char_length(name) <= 512),
          constraint chk_hashtags_normalized_not_blank check (btrim(normalized_name) <> ''),
          constraint chk_hashtags_normalized_length check (char_length(normalized_name) <= 512),
          constraint uq_hashtags_normalized_name unique (normalized_name)
        );

        create table tweet_hashtags (
          tweet_id text not null references tweets(tweet_id) on delete cascade,
          hashtag_id bigint not null references hashtags(id) on delete cascade,
          display_name text not null,
          position integer not null,
          source_engine text not null,
          metadata_path text not null,
          gallery_dl_version text,
          observed_at timestamptz not null default now(),
          primary key (tweet_id, hashtag_id),
          constraint chk_tweet_hashtags_display_not_blank check (btrim(display_name) <> ''),
          constraint chk_tweet_hashtags_display_length check (char_length(display_name) <= 512),
          constraint chk_tweet_hashtags_position check (position >= 0),
          constraint chk_tweet_hashtags_source check (source_engine = 'gallery-dl')
        );

        create index idx_tweet_hashtags_hashtag_id
        on tweet_hashtags(hashtag_id, tweet_id);

        create table hashtag_backfill_runs (
          id bigserial primary key,
          mode text not null,
          status text not null,
          gallery_dl_version text,
          log_stream_id bigint references operation_log_streams(id) on delete set null,
          last_media_id bigint not null default 0,
          result jsonb,
          error_message text,
          started_at timestamptz not null default now(),
          finished_at timestamptz,
          constraint chk_hashtag_backfill_mode check (mode in ('dry_run', 'apply')),
          constraint chk_hashtag_backfill_status check (status in ('running', 'completed', 'failed'))
        );

        alter table operation_log_streams
          drop constraint if exists chk_operation_log_streams_scope_type;

        alter table operation_log_streams
          add constraint chk_operation_log_streams_scope_type
          check (scope_type in ('source_scan', 'download_job', 'hashtag_backfill'));

        create or replace function xma_build_tweet_search_text(target_tweet_id text)
        returns text
        language sql
        stable
        as $$
          select concat_ws(
            E'\n',
            coalesce(t.text, ''),
            coalesce(t.author_username, ''),
            coalesce(t.author_display_name, ''),
            coalesce((
              select string_agg(tag.name, ' ' order by tag.normalized_name)
              from tweet_tags tt
              join tags tag on tag.id = tt.tag_id
              where tt.tweet_id = t.tweet_id
            ), ''),
            coalesce((
              select string_agg('#' || th.display_name, ' ' order by th.position, h.normalized_name)
              from tweet_hashtags th
              join hashtags h on h.id = th.hashtag_id
              where th.tweet_id = t.tweet_id
            ), ''),
            coalesce((
              select string_agg(c.name, ' ' order by c.normalized_name)
              from collection_tweets ct
              join collections c on c.id = ct.collection_id
              where ct.tweet_id = t.tweet_id
            ), ''),
            coalesce((
              select n.content
              from tweet_notes n
              where n.tweet_id = t.tweet_id
            ), '')
          )
          from tweets t
          where t.tweet_id = target_tweet_id
        $$;

        drop trigger if exists trg_tweet_hashtags_refresh_search on tweet_hashtags;
        create trigger trg_tweet_hashtags_refresh_search
        after insert or update or delete on tweet_hashtags
        for each row execute function xma_refresh_tweet_search_from_link();
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop trigger if exists trg_tweet_hashtags_refresh_search on tweet_hashtags;

        create or replace function xma_build_tweet_search_text(target_tweet_id text)
        returns text
        language sql
        stable
        as $$
          select concat_ws(
            E'\n',
            coalesce(t.text, ''),
            coalesce(t.author_username, ''),
            coalesce(t.author_display_name, ''),
            coalesce((
              select string_agg(tag.name, ' ' order by tag.normalized_name)
              from tweet_tags tt
              join tags tag on tag.id = tt.tag_id
              where tt.tweet_id = t.tweet_id
            ), ''),
            coalesce((
              select string_agg(c.name, ' ' order by c.normalized_name)
              from collection_tweets ct
              join collections c on c.id = ct.collection_id
              where ct.tweet_id = t.tweet_id
            ), ''),
            coalesce((
              select n.content
              from tweet_notes n
              where n.tweet_id = t.tweet_id
            ), '')
          )
          from tweets t
          where t.tweet_id = target_tweet_id
        $$;

        insert into tweet_search_documents (tweet_id, search_text, updated_at)
        select t.tweet_id, xma_build_tweet_search_text(t.tweet_id), now()
        from tweets t
        on conflict (tweet_id) do update
        set search_text = excluded.search_text,
            updated_at = excluded.updated_at;

        drop table hashtag_backfill_runs;
        drop table tweet_hashtags;
        drop table hashtags;

        delete from operation_log_streams
        where scope_type = 'hashtag_backfill';

        alter table operation_log_streams
          drop constraint if exists chk_operation_log_streams_scope_type;

        alter table operation_log_streams
          add constraint chk_operation_log_streams_scope_type
          check (scope_type in ('source_scan', 'download_job'));
        """
    )
