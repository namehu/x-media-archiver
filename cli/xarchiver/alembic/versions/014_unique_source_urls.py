"""enforce unique source urls

Revision ID: 014_unique_source_urls
Revises: 013_expand_log_scope
"""

from alembic import op

revision = "014_unique_source_urls"
down_revision = "013_expand_log_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        create or replace function pg_temp.xma_normalize_source_url(raw_url text)
        returns text
        language plpgsql
        immutable
        as $$
        declare
          value text := btrim(raw_url);
          without_fragment text;
          path_query text;
          path_part text;
          query_part text := '';
          query_position int;
        begin
          if value is null then
            return null;
          end if;
          if value = '' then
            return value;
          end if;
          if value !~* '^https?://(www\\.)?(x\\.com|twitter\\.com)(/|\\?|$)' then
            return value;
          end if;

          without_fragment := regexp_replace(value, '#.*$', '');
          path_query := regexp_replace(
            without_fragment,
            '^https?://(www\\.)?(x\\.com|twitter\\.com)',
            '',
            'i'
          );
          query_position := strpos(path_query, '?');
          if query_position > 0 then
            path_part := substring(path_query from 1 for query_position - 1);
            query_part := substring(path_query from query_position + 1);
          else
            path_part := path_query;
          end if;

          path_part := regexp_replace(path_part, '/+$', '');
          if query_position > 0 then
            return 'https://x.com' || path_part || '?' || query_part;
          end if;
          return 'https://x.com' || path_part;
        end;
        $$;

        do $$
        declare
          duplicate_urls text;
        begin
          select string_agg(canonical_url || ' [' || ids || ']', '; ' order by canonical_url)
          into duplicate_urls
          from (
            select
              pg_temp.xma_normalize_source_url(source_url) as canonical_url,
              string_agg(id::text, ', ' order by id) as ids
            from archive_sources
            where source_url is not null
            group by pg_temp.xma_normalize_source_url(source_url)
            having count(*) > 1
          ) duplicates;

          if duplicate_urls is not null then
            raise exception
              'duplicate archive_sources source_url after normalization: %',
              duplicate_urls;
          end if;
        end;
        $$;

        update archive_sources
        set source_url = pg_temp.xma_normalize_source_url(source_url)
        where source_url is not null;

        create unique index if not exists uq_archive_sources_source_url
        on archive_sources(source_url)
        where source_url is not null;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop index if exists uq_archive_sources_source_url;
        """
    )
