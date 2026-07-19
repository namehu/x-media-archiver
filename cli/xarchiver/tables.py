from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    MetaData,
    SmallInteger,
    Table,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

metadata = MetaData()

auth_admin = Table(
    "auth_admin",
    metadata,
    Column("id", SmallInteger, primary_key=True),
    Column("username", Text, nullable=False),
    Column("password_hash", Text, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)

auth_sessions = Table(
    "auth_sessions",
    metadata,
    Column("token_hash", Text, primary_key=True),
    Column("admin_id", SmallInteger, ForeignKey("auth_admin.id", ondelete="CASCADE"), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("last_seen_at", DateTime(timezone=True), nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
)

cookie_config = Table(
    "cookie_config",
    metadata,
    Column("id", SmallInteger),
    Column("content", Text),
    Column("label", Text),
    Column("updated_at", DateTime(timezone=True)),
    Column("validation_status", Text),
    Column("validated_at", DateTime(timezone=True)),
    Column("auth_token_expires_at", DateTime(timezone=True)),
    Column("validation_error_category", Text),
    Column("validation_message", Text),
    Column("validated_content_sha256", Text),
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

media_delete_operations = Table(
    "media_delete_operations",
    metadata,
    Column("operation_id", UUID(as_uuid=True), primary_key=True),
    Column("requested_media_ids", JSONB, nullable=False),
    Column("tweet_ids", JSONB, nullable=False),
    Column("status", Text, nullable=False),
    Column("result", JSONB),
    Column("error_message", Text),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("completed_at", DateTime(timezone=True)),
)

archive_runs = Table(
    "archive_runs",
    metadata,
    Column("id", BigInteger),
    Column("trigger_type", Text),
    Column("source_id", BigInteger),
    Column("input_path", Text),
    Column("status", Text),
    Column("blocked_by_run_id", BigInteger),
    Column("control_state", JSONB),
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
    Column("cancel_requested", Boolean),
    Column("downloaded_bytes", BigInteger),
    Column("total_bytes", BigInteger),
    Column("speed_bps", BigInteger),
    Column("progress_message", Text),
    Column("last_progress_at", DateTime(timezone=True)),
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
    Column("is_pinned", Boolean),
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

operation_log_streams = Table(
    "operation_log_streams",
    metadata,
    Column("id", BigInteger),
    Column("scope_type", Text),
    Column("scope_id", BigInteger),
    Column("log_path", Text),
    Column("metadata", JSONB),
    Column("line_count", Integer),
    Column("byte_size", BigInteger),
    Column("level_counts", JSONB),
    Column("last_level", Text),
    Column("last_message", Text),
    Column("last_log_at", DateTime(timezone=True)),
    Column("is_truncated", Boolean),
    Column("created_at", DateTime(timezone=True)),
    Column("closed_at", DateTime(timezone=True)),
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

source_scan_runs = Table(
    "source_scan_runs",
    metadata,
    Column("id", BigInteger),
    Column("source_id", BigInteger),
    Column("status", Text),
    Column("new_tweet_count", Integer),
    Column("created_at", DateTime(timezone=True)),
)

download_jobs = Table(
    "download_jobs",
    metadata,
    Column("id", BigInteger),
    Column("archive_run_id", BigInteger),
    Column("status", Text),
    Column("current_tweet_id", Text),
    Column("last_progress_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True)),
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
