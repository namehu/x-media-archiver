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
            ],
        )
        upgrade.assert_called_once()

    def test_migrate_returns_empty_list_at_head(self) -> None:
        settings = SimpleNamespace(
            database_url="postgresql://xarchiver:xarchiver@localhost:5432/xarchiver",
        )

        with (
            patch("xarchiver.migrations.get_settings", return_value=settings),
            patch("xarchiver.migrations.current_alembic_revision", return_value="004_ensure_operation_log_streams"),
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
            ["002_add_cookie_config.py", "003_add_source_scan_progress.py", "004_ensure_operation_log_streams.py"],
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


if __name__ == "__main__":
    unittest.main()
