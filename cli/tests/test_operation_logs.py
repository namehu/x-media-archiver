import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from xarchiver.db import connect
from xarchiver.services.operation_logs import (
    append_operation_log_entry,
    close_operation_log_stream,
    create_operation_log_stream,
    list_operation_log_streams,
    parse_gallery_dl_log_level,
    read_operation_log_entries,
)


class OperationLogServiceTests(unittest.TestCase):
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
