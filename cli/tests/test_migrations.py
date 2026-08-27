import importlib
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from xarchiver.migrations import migrate, pending_upgrade_paths, sqlalchemy_url


class MigrationTests(unittest.TestCase):
    def test_migrate_returns_initial_schema_revision_when_database_is_empty(self) -> None:
        settings = SimpleNamespace(
            database_url="postgresql://xarchiver:xarchiver@localhost:5432/xarchiver",
        )

        with (
            patch("xarchiver.migrations.get_settings", return_value=settings),
            patch("xarchiver.migrations.current_alembic_revision", return_value=None),
            patch("xarchiver.migrations.command.upgrade") as upgrade,
        ):
            files = migrate()

        self.assertEqual(
            [file.name for file in files],
            [
                "001_initial_schema.py",
                "002_add_cookie_config.py",
                "003_add_source_scan_progress.py",
                "004_ensure_operation_log_streams.py",
                "005_add_from_start_scan_trigger.py",
                "006_source_download_controls.py",
                "007_add_download_job_progress_message.py",
                "008_single_admin_auth.py",
                "009_add_cookie_validation.py",
                "010_add_source_pinning.py",
                "011_add_media_delete_audit.py",
                "012_add_download_job_log_stream.py",
                "013_expand_operation_log_stream_scope.py",
                "014_unique_source_urls.py",
                "015_soft_delete_sources.py",
                "016_add_source_manual_order.py",
                "017_add_source_bulk_tasks.py",
                "018_add_failure_triage.py",
                "019_harden_failure_triage.py",
                "020_add_failure_timestamps.py",
                "021_add_tweet_search.py",
                "022_add_organization_audit.py",
                "023_add_platform_hashtags.py",
                "024_add_media_privacy_mode.py",
                "025_add_media_preview_jobs.py",
            ],
        )
        upgrade.assert_called_once()

    def test_migrate_returns_empty_list_at_head(self) -> None:
        settings = SimpleNamespace(
            database_url="postgresql://xarchiver:xarchiver@localhost:5432/xarchiver",
        )

        with (
            patch("xarchiver.migrations.get_settings", return_value=settings),
            patch(
                "xarchiver.migrations.current_alembic_revision",
                return_value="025_add_media_preview_jobs",
            ),
            patch("xarchiver.migrations.command.upgrade") as upgrade,
        ):
            self.assertEqual(migrate(), [])

        upgrade.assert_called_once()

    def test_pending_paths_start_after_current_revision(self) -> None:
        settings = SimpleNamespace(
            database_url="postgresql://xarchiver:xarchiver@localhost:5432/xarchiver",
        )
        with patch(
            "xarchiver.migrations.current_alembic_revision",
            return_value="001_initial_schema",
        ):
            from xarchiver.migrations import alembic_config

            files = pending_upgrade_paths(
                alembic_config(settings.database_url),
                settings.database_url,
            )

        self.assertEqual(
            [file.name for file in files],
            [
                "002_add_cookie_config.py",
                "003_add_source_scan_progress.py",
                "004_ensure_operation_log_streams.py",
                "005_add_from_start_scan_trigger.py",
                "006_source_download_controls.py",
                "007_add_download_job_progress_message.py",
                "008_single_admin_auth.py",
                "009_add_cookie_validation.py",
                "010_add_source_pinning.py",
                "011_add_media_delete_audit.py",
                "012_add_download_job_log_stream.py",
                "013_expand_operation_log_stream_scope.py",
                "014_unique_source_urls.py",
                "015_soft_delete_sources.py",
                "016_add_source_manual_order.py",
                "017_add_source_bulk_tasks.py",
                "018_add_failure_triage.py",
                "019_harden_failure_triage.py",
                "020_add_failure_timestamps.py",
                "021_add_tweet_search.py",
                "022_add_organization_audit.py",
                "023_add_platform_hashtags.py",
                "024_add_media_privacy_mode.py",
                "025_add_media_preview_jobs.py",
            ],
        )

    def test_sqlalchemy_url_uses_psycopg_driver(self) -> None:
        self.assertEqual(
            sqlalchemy_url("postgresql://user:pass@localhost/db"),
            "postgresql+psycopg://user:pass@localhost/db",
        )
        self.assertEqual(
            sqlalchemy_url("postgresql+psycopg://user:pass@localhost/db"),
            "postgresql+psycopg://user:pass@localhost/db",
        )

    def test_initial_schema_revision_contains_core_tables(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.001_initial_schema")
        captured_sql: list[str] = []

        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.upgrade()

        sql = captured_sql[0]
        self.assertIn("create table if not exists tweets", sql)
        self.assertIn("create table if not exists media_assets", sql)
        self.assertIn("create table if not exists archive_run_items", sql)
        self.assertIn("create table if not exists source_scan_runs", sql)

    def test_organization_audit_revision_is_reversible(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.022_add_organization_audit")
        upgrade_sql: list[str] = []
        downgrade_sql: list[str] = []

        with patch.object(module.op, "execute", side_effect=upgrade_sql.append):
            module.upgrade()
        with patch.object(module.op, "execute", side_effect=downgrade_sql.append):
            module.downgrade()

        self.assertIn("create table if not exists organization_action_events", upgrade_sql[0])
        self.assertIn("idx_organization_action_events_created", upgrade_sql[0])
        self.assertIn("drop table if exists organization_action_events", downgrade_sql[0])

    def test_download_job_log_stream_revision_is_idempotent(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.012_add_download_job_log_stream")
        captured_sql: list[str] = []

        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.upgrade()

        sql = captured_sql[0]
        self.assertIn("add column if not exists log_stream_id bigint references operation_log_streams(id)", sql)
        self.assertIn("idx_download_jobs_log_stream", sql)

    def test_operation_log_scope_revision_allows_download_jobs(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.013_expand_operation_log_stream_scope")
        captured_sql: list[str] = []

        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.upgrade()

        sql = captured_sql[0]
        self.assertIn("drop constraint if exists chk_operation_log_streams_scope_type", sql)
        self.assertIn("'download_job'", sql)

    def test_cookie_config_revision_contains_singleton_table(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.002_add_cookie_config")
        captured_sql: list[str] = []

        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.upgrade()

        sql = captured_sql[0]
        self.assertIn("create table if not exists cookie_config", sql)
        self.assertIn("constraint chk_cookie_config_singleton check (id = 1)", sql)

    def test_source_scan_progress_revision_contains_log_columns(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.003_add_source_scan_progress")
        captured_sql: list[str] = []

        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.upgrade()

        sql = captured_sql[0]
        self.assertIn("create table if not exists operation_log_streams", sql)
        self.assertIn("add column if not exists progress_message text", sql)
        self.assertIn("add column if not exists log_stream_id bigint references operation_log_streams(id)", sql)
        self.assertIn("add column if not exists last_log_at timestamptz", sql)

    def test_operation_log_streams_revision_is_idempotent_for_existing_dev_databases(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.004_ensure_operation_log_streams")
        captured_sql: list[str] = []

        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.upgrade()

        sql = captured_sql[0]
        self.assertIn("create table if not exists operation_log_streams", sql)
        self.assertIn("drop column if exists log_tail", sql)
        self.assertIn("drop column if exists log_path", sql)

    def test_source_download_controls_revision_contains_queue_control_columns(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.006_source_download_controls")
        captured_sql: list[str] = []

        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.upgrade()

        sql = captured_sql[0]
        self.assertIn("add column if not exists source_id", sql)
        self.assertIn("'blocked'", sql)
        self.assertIn("add column if not exists cancel_requested", sql)
        self.assertIn("add column if not exists downloaded_bytes", sql)

    def test_download_job_progress_message_revision_contains_missing_column(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.007_add_download_job_progress_message")
        captured_sql: list[str] = []

        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.upgrade()

        sql = captured_sql[0]
        self.assertIn("alter table download_jobs", sql)
        self.assertIn("add column if not exists progress_message text", sql)

    def test_single_admin_auth_revision_creates_admin_and_session_tables(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.008_single_admin_auth")

        with (
            patch.object(module.op, "create_table") as create_table,
            patch.object(module.op, "create_index") as create_index,
        ):
            module.upgrade()

        self.assertEqual([call.args[0] for call in create_table.call_args_list], ["auth_admin", "auth_sessions"])
        create_index.assert_called_once_with(
            "ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"]
        )

    def test_cookie_validation_revision_adds_status_columns(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.009_add_cookie_validation")
        captured_sql: list[str] = []

        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.upgrade()

        sql = captured_sql[0]
        self.assertIn("add column if not exists validation_status", sql)
        self.assertIn("add column if not exists validated_at", sql)
        self.assertIn("add column if not exists validated_content_sha256", sql)

    def test_source_pinning_revision_adds_column_and_sort_index(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.010_add_source_pinning")
        captured_sql: list[str] = []

        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.upgrade()

        sql = captured_sql[0]
        self.assertIn("add column if not exists is_pinned boolean not null default false", sql)
        self.assertIn("idx_archive_sources_pinned_updated", sql)

    def test_media_delete_audit_revision_creates_audit_table(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.011_add_media_delete_audit")
        captured_sql: list[str] = []

        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.upgrade()

        sql = captured_sql[0]
        self.assertIn("create table if not exists media_delete_operations", sql)
        self.assertIn("requested_media_ids jsonb not null", sql)
        self.assertIn("idx_media_delete_operations_created_at", sql)

    def test_unique_source_urls_revision_checks_duplicates_and_adds_unique_index(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.014_unique_source_urls")
        captured_sql: list[str] = []

        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.upgrade()

        sql = captured_sql[0]
        self.assertIn("xma_normalize_source_url", sql)
        self.assertIn("duplicate archive_sources source_url after normalization", sql)
        self.assertIn("update archive_sources", sql)
        self.assertIn("create unique index if not exists uq_archive_sources_source_url", sql)
        self.assertIn("where source_url is not null", sql)

    def test_soft_delete_sources_revision_adds_deleted_at_and_active_index(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.015_soft_delete_sources")
        captured_sql: list[str] = []

        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.upgrade()

        sql = captured_sql[0]
        self.assertIn("add column if not exists deleted_at timestamptz", sql)
        self.assertIn("idx_archive_sources_active_updated", sql)
        self.assertIn("where deleted_at is null", sql)

    def test_source_manual_order_revision_adds_column_and_active_index(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.016_add_source_manual_order")
        captured_sql: list[str] = []

        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.upgrade()

        sql = captured_sql[0]
        self.assertIn("add column if not exists manual_order integer not null default 0", sql)
        self.assertIn("idx_archive_sources_active_manual_order", sql)
        self.assertIn("where deleted_at is null", sql)

    def test_source_bulk_tasks_revision_contains_task_and_schedule_tables(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.017_add_source_bulk_tasks")
        captured_sql: list[str] = []

        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.upgrade()

        sql = captured_sql[0]
        self.assertIn("create table if not exists source_bulk_tasks", sql)
        self.assertIn("create table if not exists source_bulk_task_items", sql)
        self.assertIn("create table if not exists source_schedule_policies", sql)
        self.assertIn("first_discovered_scan_run_id", sql)
        self.assertIn("last_dispatched_at", sql)
        self.assertIn("uq_source_bulk_tasks_active_schedule", sql)

    def test_failure_triage_revision_adds_state_audit_and_queue_status(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.018_add_failure_triage")
        captured_sql: list[str] = []

        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.upgrade()

        sql = captured_sql[0]
        self.assertIn("create table if not exists failure_dispositions", sql)
        self.assertIn("create table if not exists failure_action_events", sql)
        self.assertIn("'skipped_ignored'", sql)
        self.assertIn("trg_tweets_clear_failure_disposition", sql)

    def test_failure_triage_hardening_only_clears_on_success_and_audits_resolution(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.019_harden_failure_triage")
        captured_sql: list[str] = []

        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.upgrade()

        sql = captured_sql[0]
        self.assertIn("'resolved'", sql)
        self.assertIn("new.download_status in ('downloaded', 'verified')", sql)
        self.assertIn("insert into failure_action_events", sql)

        captured_sql.clear()
        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.downgrade()

        downgrade_sql = captured_sql[0]
        self.assertIn("delete from failure_dispositions d", downgrade_sql)
        self.assertIn("t.download_status not in ('failed_retryable', 'failed_permanent', 'corrupt')", downgrade_sql)

    def test_failure_timestamp_revision_uses_dedicated_trigger_managed_columns(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.020_add_failure_timestamps")
        captured_sql: list[str] = []

        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.upgrade()

        sql = captured_sql[0]
        self.assertIn("alter table tweets", sql)
        self.assertIn("alter table archive_run_items", sql)
        self.assertIn("add column if not exists failure_at timestamptz", sql)
        self.assertIn("trg_tweets_set_failure_at", sql)
        self.assertIn("trg_archive_run_items_set_failure_at", sql)

        captured_sql.clear()
        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.downgrade()

        downgrade_sql = captured_sql[0]
        self.assertIn("drop trigger if exists trg_tweets_set_failure_at", downgrade_sql)
        self.assertIn("drop column if exists failure_at", downgrade_sql)

    def test_tweet_search_revision_adds_indexes_and_refresh_triggers(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.021_add_tweet_search")
        captured_sql: list[str] = []

        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.upgrade()

        sql = captured_sql[0]
        self.assertIn("create extension if not exists pg_trgm", sql)
        self.assertIn("create table if not exists tweet_search_documents", sql)
        self.assertIn("using gin(search_vector)", sql)
        self.assertIn("gin_trgm_ops", sql)
        self.assertIn("xma_refresh_tweet_search_document", sql)
        self.assertIn("trg_tweet_notes_refresh_search", sql)

        captured_sql.clear()
        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.downgrade()

        downgrade_sql = captured_sql[0]
        self.assertIn("drop table if exists tweet_search_documents", downgrade_sql)
        self.assertIn("drop table if exists collections", downgrade_sql)
        self.assertNotIn("drop extension", downgrade_sql)

    def test_platform_hashtag_revision_adds_additive_relations_and_search_refresh(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.023_add_platform_hashtags")
        captured_sql: list[str] = []

        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.upgrade()

        sql = captured_sql[0]
        self.assertIn("create table hashtags", sql)
        self.assertIn("create table tweet_hashtags", sql)
        self.assertIn("create table hashtag_backfill_runs", sql)
        self.assertIn("hashtag_backfill", sql)
        self.assertIn("trg_tweet_hashtags_refresh_search", sql)
        self.assertIn("'#' || th.display_name", sql)

        captured_sql.clear()
        with patch.object(module.op, "execute", side_effect=captured_sql.append):
            module.downgrade()

        downgrade_sql = captured_sql[0]
        self.assertIn("drop table tweet_hashtags", downgrade_sql)
        self.assertIn("drop table hashtags", downgrade_sql)
        self.assertIn("where scope_type = 'hashtag_backfill'", downgrade_sql)
        self.assertIn("source_scan', 'download_job'", downgrade_sql)

    def test_media_privacy_revision_adds_account_preference(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.024_add_media_privacy_mode")
        added_columns: list[tuple[str, object]] = []
        dropped_columns: list[tuple[str, str]] = []

        with patch.object(
            module.op,
            "add_column",
            side_effect=lambda table, column: added_columns.append((table, column)),
        ):
            module.upgrade()
        with patch.object(
            module.op,
            "drop_column",
            side_effect=lambda table, column: dropped_columns.append((table, column)),
        ):
            module.downgrade()

        self.assertEqual(
            [(table, column.name) for table, column in added_columns],
            [("auth_admin", "media_privacy_mode")],
        )
        privacy_column = added_columns[0][1]
        self.assertFalse(privacy_column.nullable)
        self.assertIsNotNone(privacy_column.server_default)
        self.assertEqual(
            dropped_columns,
            [("auth_admin", "media_privacy_mode")],
        )

    def test_media_preview_revision_adds_job_and_singleton_schedule_tables(self) -> None:
        module = importlib.import_module("xarchiver.alembic.versions.025_add_media_preview_jobs")
        created_tables: list[str] = []
        created_indexes: list[str] = []

        with (
            patch.object(module.op, "create_table", side_effect=lambda name, *_args, **_kwargs: created_tables.append(name)),
            patch.object(module.op, "create_index", side_effect=lambda name, *_args, **_kwargs: created_indexes.append(name)),
            patch.object(module.op, "execute"),
        ):
            module.upgrade()

        self.assertEqual(
            created_tables,
            ["media_preview_scheduler_settings", "media_preview_jobs"],
        )
        self.assertIn("uq_media_preview_jobs_active", created_indexes)
        self.assertEqual(module.down_revision, "024_add_media_privacy_mode")


if __name__ == "__main__":
    unittest.main()
