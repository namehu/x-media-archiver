from __future__ import annotations

from sqlalchemy import BigInteger, Column, DateTime, Integer, MetaData, SmallInteger, Table, Text
from sqlalchemy.dialects.postgresql import JSONB

metadata = MetaData()

cookie_config = Table(
    "cookie_config",
    metadata,
    Column("id", SmallInteger),
    Column("content", Text),
    Column("label", Text),
    Column("updated_at", DateTime(timezone=True)),
)

tweets = Table(
    "tweets",
    metadata,
    Column("tweet_id", Text),
    Column("url", Text),
    Column("author_username", Text),
    Column("author_display_name", Text),
    Column("published_at", DateTime(timezone=True)),
    Column("text", Text),
    Column("source_type", Text),
    Column("source_url", Text),
    Column("collected_at", DateTime(timezone=True)),
    Column("imported_at", DateTime(timezone=True)),
    Column("download_status", Text),
    Column("raw_import", JSONB),
    Column("last_error", Text),
    Column("retry_count", Integer),
    Column("last_attempt_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

media_assets = Table(
    "media_assets",
    metadata,
    Column("id", BigInteger),
    Column("tweet_id", Text),
    Column("media_index", Integer),
    Column("media_type", Text),
    Column("download_status", Text),
    Column("source_engine", Text),
    Column("local_path", Text),
    Column("metadata_path", Text),
    Column("original_filename", Text),
    Column("file_ext", Text),
    Column("file_size", BigInteger),
    Column("sha256", Text),
    Column("width", Integer),
    Column("height", Integer),
    Column("duration_ms", Integer),
    Column("updated_at", DateTime(timezone=True)),
)

archive_runs = Table(
    "archive_runs",
    metadata,
    Column("id", BigInteger),
    Column("trigger_type", Text),
    Column("input_path", Text),
    Column("status", Text),
    Column("started_at", DateTime(timezone=True)),
    Column("finished_at", DateTime(timezone=True)),
    Column("result", JSONB),
    Column("error_message", Text),
)

archive_run_items = Table(
    "archive_run_items",
    metadata,
    Column("id", BigInteger),
    Column("archive_run_id", BigInteger),
    Column("tweet_id", Text),
    Column("status", Text),
)

archive_sources = Table(
    "archive_sources",
    metadata,
    Column("id", BigInteger),
    Column("source_type", Text),
    Column("source_url", Text),
    Column("label", Text),
    Column("author_username", Text),
    Column("status", Text),
    Column("cursor_state", JSONB),
    Column("last_seen_tweet_id", Text),
    Column("newest_seen_tweet_id", Text),
    Column("oldest_seen_tweet_id", Text),
    Column("discovered_count", Integer),
    Column("submitted_count", Integer),
    Column("error_category", Text),
    Column("error_message", Text),
    Column("last_scan_at", DateTime(timezone=True)),
    Column("next_scan_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

source_discovered_tweets = Table(
    "source_discovered_tweets",
    metadata,
    Column("id", BigInteger),
    Column("source_id", BigInteger),
    Column("tweet_id", Text),
    Column("archive_run_id", BigInteger),
    Column("discovered_at", DateTime(timezone=True)),
    Column("raw_payload", JSONB),
)

download_attempts = Table(
    "download_attempts",
    metadata,
    Column("id", BigInteger),
    Column("archive_run_item_id", BigInteger),
    Column("job_id", BigInteger),
    Column("tweet_id", Text),
    Column("engine", Text),
    Column("status", Text),
    Column("exit_code", Integer),
    Column("error_category", Text),
    Column("error_message", Text),
    Column("stderr_excerpt", Text),
    Column("started_at", DateTime(timezone=True)),
    Column("finished_at", DateTime(timezone=True)),
)
