"""add tweet search documents and organization foundations

Revision ID: 021_add_tweet_search
Revises: 020_add_failure_timestamps
"""

from alembic import op

revision = "021_add_tweet_search"
down_revision = "020_add_failure_timestamps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PostgreSQL generated tsvector columns, pg_trgm operator indexes, and
    # cross-table refresh triggers are intentionally expressed as migration SQL.
    op.execute(
        """
        create extension if not exists pg_trgm;

        create table if not exists tags (
          id bigserial primary key,
          name text not null,
          normalized_name text generated always as (lower(btrim(name))) stored,
          color text,
          description text,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          constraint chk_tags_name_not_blank check (btrim(name) <> ''),
          constraint uq_tags_normalized_name unique (normalized_name)
        );

        create table if not exists collections (
          id bigserial primary key,
          name text not null,
          normalized_name text generated always as (lower(btrim(name))) stored,
          description text,
          cover_media_id bigint references media_assets(id) on delete set null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          constraint chk_collections_name_not_blank check (btrim(name) <> ''),
          constraint uq_collections_normalized_name unique (normalized_name)
        );

        create table if not exists tweet_tags (
          tweet_id text not null references tweets(tweet_id) on delete cascade,
          tag_id bigint not null references tags(id) on delete cascade,
          created_at timestamptz not null default now(),
          primary key (tweet_id, tag_id)
        );

        create index if not exists idx_tweet_tags_tag_id
        on tweet_tags(tag_id, tweet_id);

        create table if not exists collection_tweets (
          collection_id bigint not null references collections(id) on delete cascade,
          tweet_id text not null references tweets(tweet_id) on delete cascade,
          created_at timestamptz not null default now(),
          primary key (collection_id, tweet_id)
        );

        create index if not exists idx_collection_tweets_tweet_id
        on collection_tweets(tweet_id, collection_id);

        create table if not exists tweet_notes (
          tweet_id text primary key references tweets(tweet_id) on delete cascade,
          content text not null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );

        create table if not exists tweet_search_documents (
          tweet_id text primary key references tweets(tweet_id) on delete cascade,
          search_text text not null default '',
          search_vector tsvector generated always as (
            to_tsvector('simple'::regconfig, search_text)
          ) stored,
          updated_at timestamptz not null default now()
        );

        create index if not exists idx_tweet_search_documents_vector
        on tweet_search_documents using gin(search_vector);

        create index if not exists idx_tweet_search_documents_trgm
        on tweet_search_documents using gin(lower(search_text) gin_trgm_ops);

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

        create or replace function xma_refresh_tweet_search_document(target_tweet_id text)
        returns void
        language plpgsql
        as $$
        declare
          document_text text;
        begin
          document_text := xma_build_tweet_search_text(target_tweet_id);
          if document_text is null then
            delete from tweet_search_documents where tweet_id = target_tweet_id;
            return;
          end if;

          insert into tweet_search_documents (tweet_id, search_text, updated_at)
          values (target_tweet_id, document_text, now())
          on conflict (tweet_id) do update
          set search_text = excluded.search_text,
              updated_at = excluded.updated_at;
        end;
        $$;

        create or replace function xma_refresh_tweet_search_from_tweet()
        returns trigger
        language plpgsql
        as $$
        begin
          perform xma_refresh_tweet_search_document(new.tweet_id);
          return new;
        end;
        $$;

        create or replace function xma_refresh_tweet_search_from_link()
        returns trigger
        language plpgsql
        as $$
        begin
          if tg_op = 'DELETE' then
            perform xma_refresh_tweet_search_document(old.tweet_id);
            return old;
          end if;
          perform xma_refresh_tweet_search_document(new.tweet_id);
          if tg_op = 'UPDATE' and old.tweet_id is distinct from new.tweet_id then
            perform xma_refresh_tweet_search_document(old.tweet_id);
          end if;
          return new;
        end;
        $$;

        create or replace function xma_refresh_tweet_search_from_tag()
        returns trigger
        language plpgsql
        as $$
        declare
          target_id text;
        begin
          for target_id in
            select tt.tweet_id
            from tweet_tags tt
            where tt.tag_id = new.id
          loop
            perform xma_refresh_tweet_search_document(target_id);
          end loop;
          return new;
        end;
        $$;

        create or replace function xma_refresh_tweet_search_from_collection()
        returns trigger
        language plpgsql
        as $$
        declare
          target_id text;
        begin
          for target_id in
            select ct.tweet_id
            from collection_tweets ct
            where ct.collection_id = new.id
          loop
            perform xma_refresh_tweet_search_document(target_id);
          end loop;
          return new;
        end;
        $$;

        drop trigger if exists trg_tweets_refresh_search on tweets;
        create trigger trg_tweets_refresh_search
        after insert or update of text, author_username, author_display_name on tweets
        for each row execute function xma_refresh_tweet_search_from_tweet();

        drop trigger if exists trg_tweet_tags_refresh_search on tweet_tags;
        create trigger trg_tweet_tags_refresh_search
        after insert or update or delete on tweet_tags
        for each row execute function xma_refresh_tweet_search_from_link();

        drop trigger if exists trg_collection_tweets_refresh_search on collection_tweets;
        create trigger trg_collection_tweets_refresh_search
        after insert or update or delete on collection_tweets
        for each row execute function xma_refresh_tweet_search_from_link();

        drop trigger if exists trg_tweet_notes_refresh_search on tweet_notes;
        create trigger trg_tweet_notes_refresh_search
        after insert or update or delete on tweet_notes
        for each row execute function xma_refresh_tweet_search_from_link();

        drop trigger if exists trg_tags_refresh_search on tags;
        create trigger trg_tags_refresh_search
        after update of name, description on tags
        for each row execute function xma_refresh_tweet_search_from_tag();

        drop trigger if exists trg_collections_refresh_search on collections;
        create trigger trg_collections_refresh_search
        after update of name, description on collections
        for each row execute function xma_refresh_tweet_search_from_collection();

        insert into tweet_search_documents (tweet_id, search_text, updated_at)
        select t.tweet_id, xma_build_tweet_search_text(t.tweet_id), now()
        from tweets t
        on conflict (tweet_id) do update
        set search_text = excluded.search_text,
            updated_at = excluded.updated_at;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop trigger if exists trg_collections_refresh_search on collections;
        drop trigger if exists trg_tags_refresh_search on tags;
        drop trigger if exists trg_tweet_notes_refresh_search on tweet_notes;
        drop trigger if exists trg_collection_tweets_refresh_search on collection_tweets;
        drop trigger if exists trg_tweet_tags_refresh_search on tweet_tags;
        drop trigger if exists trg_tweets_refresh_search on tweets;

        drop function if exists xma_refresh_tweet_search_from_collection();
        drop function if exists xma_refresh_tweet_search_from_tag();
        drop function if exists xma_refresh_tweet_search_from_link();
        drop function if exists xma_refresh_tweet_search_from_tweet();
        drop function if exists xma_refresh_tweet_search_document(text);
        drop function if exists xma_build_tweet_search_text(text);

        drop table if exists tweet_search_documents;
        drop table if exists tweet_notes;
        drop table if exists collection_tweets;
        drop table if exists tweet_tags;
        drop table if exists collections;
        drop table if exists tags;

        -- pg_trgm may be shared by other schemas or applications, so downgrade
        -- intentionally leaves the extension installed.
        """
    )
