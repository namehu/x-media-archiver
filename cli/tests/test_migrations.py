import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

from xarchiver.migrations import migrate


class FakeCursor:
    def __init__(self, connection: "FakeConnection") -> None:
        self.connection = connection
        self.result: dict[str, str] | None = None

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def execute(self, sql: str, params: tuple[str, ...] = ()) -> None:
        normalized = " ".join(sql.split()).lower()
        if normalized.startswith("create table if not exists xarchiver_schema_migrations"):
            return
        if normalized.startswith("select checksum from xarchiver_schema_migrations"):
            checksum = self.connection.applied.get(params[0])
            self.result = {"checksum": checksum} if checksum else None
            return
        if normalized.startswith("insert into xarchiver_schema_migrations"):
            self.connection.applied[params[0]] = params[1]
            return
        self.connection.executed_migrations.append(sql.strip())

    def fetchone(self) -> dict[str, str] | None:
        return self.result


class FakeConnection:
    def __init__(self) -> None:
        self.applied: dict[str, str] = {}
        self.executed_migrations: list[str] = []
        self.commits = 0

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)

    def commit(self) -> None:
        self.commits += 1


class MigrationTests(unittest.TestCase):
    def test_migrate_only_applies_new_files(self) -> None:
        connection = FakeConnection()

        @contextmanager
        def fake_connect():
            yield connection

        with tempfile.TemporaryDirectory() as tmp:
            sql_dir = Path(tmp)
            migration = sql_dir / "001_init.sql"
            migration.write_text("create table test_table (id int);", encoding="utf-8")
            with patch("xarchiver.migrations.connect", fake_connect):
                self.assertEqual(migrate(sql_dir), [migration])
                self.assertEqual(migrate(sql_dir), [])

        self.assertEqual(connection.executed_migrations, ["create table test_table (id int);"])

    def test_migrate_rejects_changed_applied_file(self) -> None:
        connection = FakeConnection()

        @contextmanager
        def fake_connect():
            yield connection

        with tempfile.TemporaryDirectory() as tmp:
            sql_dir = Path(tmp)
            migration = sql_dir / "001_init.sql"
            migration.write_text("create table test_table (id int);", encoding="utf-8")
            with patch("xarchiver.migrations.connect", fake_connect):
                migrate(sql_dir)
                migration.write_text("create table changed_table (id int);", encoding="utf-8")
                with self.assertRaisesRegex(RuntimeError, "checksum mismatch"):
                    migrate(sql_dir)


if __name__ == "__main__":
    unittest.main()
