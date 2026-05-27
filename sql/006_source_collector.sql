alter table archive_sources
add column if not exists author_username text,
add column if not exists status text not null default 'active',
add column if not exists cursor_state jsonb not null default '{}'::jsonb,
add column if not exists last_seen_tweet_id text,
add column if not exists newest_seen_tweet_id text,
add column if not exists oldest_seen_tweet_id text,
add column if not exists discovered_count int not null default 0,
add column if not exists submitted_count int not null default 0,
add column if not exists error_category text,
add column if not exists error_message text,
add column if not exists last_scan_at timestamptz,
add column if not exists next_scan_at timestamptz,
add column if not exists updated_at timestamptz not null default now();

alter table archive_sources
drop constraint if exists chk_archive_sources_status;

alter table archive_sources
add constraint chk_archive_sources_status check (
  status in ('active', 'paused', 'completed', 'failed')
);

create index if not exists idx_archive_sources_status
on archive_sources(status);

create index if not exists idx_archive_sources_author_username
on archive_sources(author_username);

create table if not exists source_discovered_tweets (
  id bigserial primary key,
  source_id bigint not null references archive_sources(id) on delete cascade,
  tweet_id text not null references tweets(tweet_id) on delete cascade,
  archive_run_id bigint references archive_runs(id) on delete set null,
  discovered_at timestamptz not null default now(),
  raw_payload jsonb,
  constraint uq_source_discovered_tweets_source_tweet unique (source_id, tweet_id)
);

create index if not exists idx_source_discovered_tweets_source_id
on source_discovered_tweets(source_id);

create index if not exists idx_source_discovered_tweets_tweet_id
on source_discovered_tweets(tweet_id);
