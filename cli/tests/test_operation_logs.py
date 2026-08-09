import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from xarchiver.db import connect
from xarchiver.services.operation_logs import (
    _read_operation_log_file_stats,
    _reconcile_operation_log_stream,
    append_operation_log_entries,
    append_operation_log_entry,
    close_operation_log_stream,
    create_operation_log_stream,
    list_operation_log_streams,
    parse_gallery_dl_log_level,
    read_operation_log_entries,
    redact_sensitive_text,
)


class OperationLogServiceTests(unittest.TestCase):
    def test_redact_sensitive_text_covers_headers_and_url_query_tokens(self) -> None:
        value = redact_sensitive_text(
            "Authorization: Bearer secret-token\n"
            "x-csrf-token: csrf-value\n"
            "https://example.test/file?token=secret&sig=signature"
        )

        self.assertNotIn("secret-token", value)
        self.assertNotIn("csrf-value", value)
        self.assertNotIn("signature", value)
        self.assertIn("[redacted]", value)

    def tearDown(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("delete from operation_log_streams where metadata->>'test_case' = 'operation_logs'")
            conn.commit()

    def test_append_read_filter_and_close_log_stream(self) -> None:
        with TemporaryDirectory() as tmpdir:
            archive_dir = Path(tmpdir)
            settings = SimpleNamespace(archive_dir=archive_dir, operation_log_max_bytes=10_000)
            with patch("xarchiver.services.operation_logs.get_settings", return_value=settings):
                stream_id = create_operation_log_stream(
                    "source_scan",
                    9001,
                    "logs/source-scan-logs/source-1/scan-run-9001.jsonl",
                    {"source_id": 1, "test_case": "operation_logs"},
                )
                append_operation_log_entry(stream_id, "info", "gallery-dl", "Starting gallery-dl.")
                append_operation_log_entry(stream_id, "error", "gallery-dl", "failed auth_token=secret")

                recent = read_operation_log_entries(stream_id, limit=10)
                only_error = read_operation_log_entries(stream_id, limit=10, levels={"error"})
                close_operation_log_stream(stream_id)
                page = list_operation_log_streams(source_id=1, level="error")

        self.assertTrue(recent["available"])
        self.assertEqual([entry["level"] for entry in recent["entries"]], ["info", "error"])
        self.assertEqual([entry["level"] for entry in only_error["entries"]], ["error"])
        self.assertIn("auth_token=[redacted]", only_error["entries"][0]["message"])
        self.assertGreater(int(recent["next_cursor"]), 0)
        self.assertGreaterEqual(page["total_count"], 1)

    def test_batch_append_writes_multiple_entries_with_one_log_event(self) -> None:
        with TemporaryDirectory() as tmpdir:
            settings = SimpleNamespace(archive_dir=Path(tmpdir), operation_log_max_bytes=10_000)
            with patch("xarchiver.services.operation_logs.get_settings", return_value=settings), patch(
                "xarchiver.services.operation_logs.publish_event"
            ) as publish:
                stream_id = create_operation_log_stream(
                    "download_job",
                    9004,
                    "logs/download-logs/job-9004.jsonl",
                    {"test_case": "operation_logs"},
                )
                written = append_operation_log_entries(
                    stream_id,
                    [
                        {"level": "info", "component": "yt-dlp.stdout", "message": "one"},
                        {"level": "error", "component": "yt-dlp.stderr", "message": "two"},
                    ],
                )
                result = read_operation_log_entries(stream_id, limit=10)

        self.assertEqual(len(written), 2)
        self.assertEqual([entry["message"] for entry in result["entries"]], ["one", "two"])
        publish.assert_called_once()
        self.assertEqual(publish.call_args.args[2]["entry_count"], 2)

    def test_uncertain_commit_preserves_file_and_reconciles_instead_of_truncating(self) -> None:
        class FakeCursor:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def execute(self, _sql, _params=None):
                return None

            def fetchone(self):
                return {
                    "id": 91,
                    "scope_type": "source_scan",
                    "scope_id": 9005,
                    "log_path": "logs/source-scan-logs/source-1/rollback.jsonl",
                    "line_count": 1,
                    "byte_size": len(b"existing\n"),
                    "level_counts": {"info": 1},
                    "is_truncated": False,
                }

        class FailingCommitConnection:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def cursor(self):
                return FakeCursor()

            def commit(self):
                raise RuntimeError("database commit failed")

        with TemporaryDirectory() as tmpdir:
            archive_dir = Path(tmpdir)
            path = archive_dir / "logs/source-scan-logs/source-1/rollback.jsonl"
            path.parent.mkdir(parents=True)
            path.write_bytes(b"existing\n")
            settings = SimpleNamespace(archive_dir=archive_dir, operation_log_max_bytes=10_000)
            with (
                patch("xarchiver.services.operation_logs.connect", return_value=FailingCommitConnection()),
                patch("xarchiver.services.operation_logs.get_settings", return_value=settings),
                patch("xarchiver.services.operation_logs._reconcile_operation_log_stream") as reconcile,
                patch("xarchiver.services.operation_logs.publish_event") as publish,
                self.assertRaisesRegex(RuntimeError, "database commit failed"),
            ):
                append_operation_log_entries(
                    91,
                    [{"level": "error", "component": "gallery-dl", "message": "new entry"}],
                )

            self.assertTrue(path.read_bytes().startswith(b"existing\n"))
            self.assertIn(b"new entry", path.read_bytes())
            reconcile.assert_called_once_with(91)
            publish.assert_not_called()

    def test_reconcile_rebuilds_stream_metadata_from_log_file(self) -> None:
        with TemporaryDirectory() as tmpdir:
            archive_dir = Path(tmpdir)
            settings = SimpleNamespace(archive_dir=archive_dir, operation_log_max_bytes=10_000)
            with patch("xarchiver.services.operation_logs.get_settings", return_value=settings):
                stream_id = create_operation_log_stream(
                    "source_scan",
                    9006,
                    "logs/source-scan-logs/source-1/reconcile.jsonl",
                    {"source_id": 1, "test_case": "operation_logs"},
                )
                append_operation_log_entries(
                    stream_id,
                    [
                        {"level": "info", "component": "gallery-dl", "message": "one"},
                        {"level": "error", "component": "gallery-dl", "message": "two"},
                    ],
                )
                path = archive_dir / "logs/source-scan-logs/source-1/reconcile.jsonl"
                with connect() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            update operation_log_streams
                            set line_count = 0,
                                byte_size = 0,
                                level_counts = '{}'::jsonb,
                                last_level = null,
                                last_message = null
                            where id = %s
                            """,
                            (stream_id,),
                        )
                    conn.commit()

                _reconcile_operation_log_stream(stream_id)
                file_size = path.stat().st_size

                with connect() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            select line_count, byte_size, level_counts, last_level, last_message
                            from operation_log_streams
                            where id = %s
                            """,
                            (stream_id,),
                        )
                        row = cur.fetchone()

        self.assertEqual(row["line_count"], 2)
        self.assertEqual(row["byte_size"], file_size)
        self.assertEqual(row["level_counts"], {"info": 1, "error": 1})
        self.assertEqual(row["last_level"], "error")
        self.assertEqual(row["last_message"], "two")

    def test_append_repairs_file_size_drift_before_writing_next_batch(self) -> None:
        with TemporaryDirectory() as tmpdir:
            archive_dir = Path(tmpdir)
            settings = SimpleNamespace(archive_dir=archive_dir, operation_log_max_bytes=10_000)
            with patch("xarchiver.services.operation_logs.get_settings", return_value=settings):
                stream_id = create_operation_log_stream(
                    "source_scan",
                    9007,
                    "logs/source-scan-logs/source-1/self-heal.jsonl",
                    {"source_id": 1, "test_case": "operation_logs"},
                )
                append_operation_log_entry(stream_id, "info", "gallery-dl", "committed")
                path = archive_dir / "logs/source-scan-logs/source-1/self-heal.jsonl"
                with path.open("ab") as handle:
                    handle.write(
                        b'{"timestamp":"2026-08-09T12:00:00Z","level":"warning",'
                        b'"component":"gallery-dl","message":"crash-window"}\n'
                    )

                append_operation_log_entry(stream_id, "error", "gallery-dl", "after-restart")
                with connect() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            select line_count, byte_size, level_counts, last_level, last_message
                            from operation_log_streams
                            where id = %s
                            """,
                            (stream_id,),
                        )
                        row = cur.fetchone()
                file_size = path.stat().st_size

        self.assertEqual(row["line_count"], 3)
        self.assertEqual(row["byte_size"], file_size)
        self.assertEqual(row["level_counts"], {"info": 1, "warning": 1, "error": 1})
        self.assertEqual(row["last_level"], "error")
        self.assertEqual(row["last_message"], "after-restart")

    def test_append_recovers_partial_json_tail_before_writing_next_batch(self) -> None:
        with TemporaryDirectory() as tmpdir:
            archive_dir = Path(tmpdir)
            settings = SimpleNamespace(archive_dir=archive_dir, operation_log_max_bytes=10_000)
            with patch("xarchiver.services.operation_logs.get_settings", return_value=settings):
                stream_id = create_operation_log_stream(
                    "source_scan",
                    9008,
                    "logs/source-scan-logs/source-1/partial-json.jsonl",
                    {"source_id": 1, "test_case": "operation_logs"},
                )
                append_operation_log_entry(stream_id, "info", "gallery-dl", "committed")
                path = archive_dir / "logs/source-scan-logs/source-1/partial-json.jsonl"
                with path.open("ab") as handle:
                    handle.write(b'{"level":"warning","message":"unfinished')

                _reconcile_operation_log_stream(stream_id)
                with connect() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            select line_count, byte_size, level_counts, last_level,
                                   last_message, is_truncated
                            from operation_log_streams
                            where id = %s
                            """,
                            (stream_id,),
                        )
                        recovered_row = cur.fetchone()
                recovered_file_size = path.stat().st_size
                append_operation_log_entry(stream_id, "error", "gallery-dl", "after-recovery")
                result = read_operation_log_entries(stream_id, limit=10)

        self.assertEqual(recovered_row["line_count"], 2)
        self.assertEqual(recovered_row["byte_size"], recovered_file_size)
        self.assertEqual(recovered_row["level_counts"], {"info": 1, "warning": 1})
        self.assertEqual(recovered_row["last_level"], "warning")
        self.assertEqual(
            recovered_row["last_message"],
            "操作日志尾部存在未完成记录，已恢复到最后一条完整记录。",
        )
        self.assertFalse(recovered_row["is_truncated"])
        self.assertEqual(
            [entry["message"] for entry in result["entries"]],
            [
                "committed",
                "操作日志尾部存在未完成记录，已恢复到最后一条完整记录。",
                "after-recovery",
            ],
        )

    def test_append_recovers_partial_utf8_tail_before_writing_next_batch(self) -> None:
        with TemporaryDirectory() as tmpdir:
            archive_dir = Path(tmpdir)
            settings = SimpleNamespace(archive_dir=archive_dir, operation_log_max_bytes=10_000)
            with patch("xarchiver.services.operation_logs.get_settings", return_value=settings):
                stream_id = create_operation_log_stream(
                    "source_scan",
                    9009,
                    "logs/source-scan-logs/source-1/partial-utf8.jsonl",
                    {"source_id": 1, "test_case": "operation_logs"},
                )
                append_operation_log_entry(stream_id, "info", "gallery-dl", "committed")
                path = archive_dir / "logs/source-scan-logs/source-1/partial-utf8.jsonl"
                with path.open("ab") as handle:
                    handle.write(b'{"level":"warning","message":"\xe4\xb8')

                append_operation_log_entry(stream_id, "error", "gallery-dl", "after-recovery")
                result = read_operation_log_entries(stream_id, limit=10)
                recovered_text = path.read_text(encoding="utf-8")

        self.assertEqual(result["entries"][-2]["level"], "warning")
        self.assertEqual(result["entries"][-1]["message"], "after-recovery")
        self.assertIn("after-recovery", recovered_text)

    def test_log_repair_rejects_middle_corruption_without_modifying_file(self) -> None:
        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "corrupt-middle.jsonl"
            original = (
                b'{"level":"info","message":"one"}\n'
                b'{not-json}\n'
                b'{"level":"info","message":"three"}\n'
            )
            path.write_bytes(original)

            with self.assertRaisesRegex(ValueError, "invalid_operation_log_entry"):
                _read_operation_log_file_stats(path)

            self.assertEqual(path.read_bytes(), original)

    def test_missing_log_file_returns_unavailable_without_losing_stream(self) -> None:
        with TemporaryDirectory() as tmpdir:
            settings = SimpleNamespace(archive_dir=Path(tmpdir), operation_log_max_bytes=10_000)
            with patch("xarchiver.services.operation_logs.get_settings", return_value=settings):
                stream_id = create_operation_log_stream(
                    "source_scan",
                    9002,
                    "logs/source-scan-logs/source-1/missing.jsonl",
                    {"source_id": 1, "test_case": "operation_logs"},
                )
                result = read_operation_log_entries(stream_id)

        self.assertFalse(result["available"])
        self.assertEqual(result["entries"], [])

    def test_exception_and_truncation_are_structured(self) -> None:
        with TemporaryDirectory() as tmpdir:
            settings = SimpleNamespace(archive_dir=Path(tmpdir), operation_log_max_bytes=2500)
            with patch("xarchiver.services.operation_logs.get_settings", return_value=settings):
                stream_id = create_operation_log_stream(
                    "source_scan",
                    9003,
                    "logs/source-scan-logs/source-1/truncated.jsonl",
                    {"source_id": 1, "test_case": "operation_logs"},
                )
                try:
                    raise RuntimeError("boom")
                except RuntimeError as exc:
                    append_operation_log_entry(stream_id, "error", "source-scan", "failed", exception=exc)
                append_operation_log_entry(stream_id, "info", "gallery-dl", "x" * 5000)
                result = read_operation_log_entries(stream_id, limit=10)

        self.assertIn("exception", result["entries"][0])
        self.assertEqual(result["entries"][0]["exception"]["type"], "RuntimeError")
        self.assertTrue(result["is_truncated"])
        self.assertEqual(result["entries"][-1]["level"], "warning")

    def test_gallery_dl_level_parser(self) -> None:
        self.assertEqual(parse_gallery_dl_log_level("[gallery-dl][debug] Version"), "debug")
        self.assertEqual(parse_gallery_dl_log_level("[twitter][info] Loading"), "info")
        self.assertEqual(parse_gallery_dl_log_level("[twitter][warn] Slow"), "warning")
        self.assertEqual(parse_gallery_dl_log_level("plain text"), "info")


if __name__ == "__main__":
    unittest.main()
