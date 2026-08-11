"""共享的 SQLAlchemy Core 表定义。

这里集中声明后端各模块共用的数据库表结构，供查询构造和 DML 语句复用。
"""

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
    Time,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

metadata = MetaData()

# 认证与 Cookie 配置
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
    Column("failure_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

failure_dispositions = Table(
    "failure_dispositions",
    metadata,
    Column("tweet_id", Text, ForeignKey("tweets.tweet_id", ondelete="CASCADE"), primary_key=True),
    Column("reason", Text),
    Column("note", Text),
    Column("ignored_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
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

# 归档运行与来源扫描
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
    Column("last_dispatched_at", DateTime(timezone=True)),
)

archive_run_items = Table(
    "archive_run_items",
    metadata,
    Column("id", BigInteger),
    Column("archive_run_id", BigInteger),
    Column("tweet_id", Text),
    Column("input_payload", JSONB),
    Column("status", Text),
    Column("retry_count", Integer),
    Column("last_attempt_at", DateTime(timezone=True)),
    Column("next_attempt_at", DateTime(timezone=True)),
    Column("error_category", Text),
    Column("error_message", Text),
    Column("linked_item_id", BigInteger),
    Column("worker_id", Text),
    Column("lease_expires_at", DateTime(timezone=True)),
    Column("claimed_at", DateTime(timezone=True)),
    Column("cancel_requested", Boolean),
    Column("downloaded_bytes", BigInteger),
    Column("total_bytes", BigInteger),
    Column("speed_bps", BigInteger),
    Column("progress_message", Text),
    Column("last_progress_at", DateTime(timezone=True)),
    Column("failure_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

failure_action_events = Table(
    "failure_action_events",
    metadata,
    Column("id", BigInteger, primary_key=True),
    Column("tweet_id", Text, ForeignKey("tweets.tweet_id", ondelete="CASCADE"), nullable=False),
    Column("action", Text, nullable=False),
    Column("previous_status", Text, nullable=False),
    Column("reason", Text),
    Column("note", Text),
    Column("archive_run_id", BigInteger, ForeignKey("archive_runs.id", ondelete="SET NULL")),
    Column("result", JSONB, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
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
    Column("manual_order", Integer),
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
    Column("deleted_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

source_schedule_policies = Table(
    "source_schedule_policies",
    metadata,
    Column("id", BigInteger),
    Column("label", Text),
    Column("action", Text),
    Column("frequency_kind", Text),
    Column("interval_minutes", Integer),
    Column("local_time", Time),
    Column("weekday", SmallInteger),
    Column("timezone", Text),
    Column("jitter_seconds", Integer),
    Column("max_downloads_per_source", Integer),
    Column("max_downloads_per_task", Integer),
    Column("enabled", Boolean),
    Column("next_run_at", DateTime(timezone=True)),
    Column("last_run_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

source_bulk_tasks = Table(
    "source_bulk_tasks",
    metadata,
    Column("id", BigInteger),
    Column("task_type", Text),
    Column("trigger_type", Text),
    Column("status", Text),
    Column("schedule_policy_id", BigInteger),
    Column("source_filter", JSONB),
    Column("options", JSONB),
    Column("total_count", Integer),
    Column("error_category", Text),
    Column("error_message", Text),
    Column("started_at", DateTime(timezone=True)),
    Column("finished_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

source_bulk_task_items = Table(
    "source_bulk_task_items",
    metadata,
    Column("id", BigInteger),
    Column("task_id", BigInteger),
    Column("source_id", BigInteger),
    Column("position", Integer),
    Column("wave_index", Integer),
    Column("status", Text),
    Column("scan_run_ids", ARRAY(BigInteger)),
    Column("archive_run_id", BigInteger),
    Column("discovered_count", Integer),
    Column("new_tweet_count", Integer),
    Column("submitted_count", Integer),
    Column("skip_reason", Text),
    Column("error_category", Text),
    Column("error_message", Text),
    Column("started_at", DateTime(timezone=True)),
    Column("finished_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

source_schedule_policy_sources = Table(
    "source_schedule_policy_sources",
    metadata,
    Column("policy_id", BigInteger),
    Column("source_id", BigInteger),
    Column("created_at", DateTime(timezone=True)),
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
    Column("first_discovered_scan_run_id", BigInteger),
)

source_scan_runs = Table(
    "source_scan_runs",
    metadata,
    Column("id", BigInteger),
    Column("source_id", BigInteger),
    Column("status", Text),
    Column("discovered_tweet_count", Integer),
    Column("new_tweet_count", Integer),
    Column("error_category", Text),
    Column("error_message", Text),
    Column("source_bulk_task_item_id", BigInteger),
    Column("finished_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True)),
)

download_jobs = Table(
    "download_jobs",
    metadata,
    Column("id", BigInteger),
    Column("archive_run_id", BigInteger),
    Column("status", Text),
    Column("current_tweet_id", Text),
    Column("log_stream_id", BigInteger),
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
