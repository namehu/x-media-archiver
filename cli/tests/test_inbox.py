import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from xarchiver.services.inbox import file_sha256, process_inbox_import, scan_inbox, scheduler_due


class InboxTests(unittest.TestCase):
    def test_file_sha256_hashes_file_content(self) -> None:
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "tweets.txt"
            path.write_text("same content", encoding="utf-8")
            self.assertEqual(
                file_sha256(path),
                "a636bd7cd42060a4d07fa1bfbcc010eb7794c2ba721e1e3e4c20335a15b66eaf",
            )

    def test_scan_inbox_only_registers_supported_files(self) -> None:
        with TemporaryDirectory() as tmp:
            archive_dir = Path(tmp)
            inbox_dir = archive_dir / "inbox"
            inbox_dir.mkdir(parents=True)
            (inbox_dir / "tweets.txt").write_text("https://x.com/u/status/1\n", encoding="utf-8")
            (inbox_dir / "tweets.jsonl").write_text("{}\n", encoding="utf-8")
            (inbox_dir / "notes.csv").write_text("ignored\n", encoding="utf-8")
            settings = SimpleNamespace(archive_dir=archive_dir)

            with (
                patch("xarchiver.services.inbox.ensure_archive_dirs"),
                patch("xarchiver.services.inbox.register_file", side_effect=[True, False]) as register,
                patch("xarchiver.services.inbox.mark_scheduler_scan"),
            ):
                result = scan_inbox(settings)

        self.assertEqual(result["discovered"], 1)
        self.assertEqual(result["known"], 1)
        self.assertEqual(result["unsupported"], 1)
        self.assertEqual(register.call_count, 2)

    def test_scheduler_due_honors_enabled_and_next_scan(self) -> None:
        now = datetime.now(UTC)

        self.assertFalse(scheduler_due({"enabled": False, "next_scan_at": None}, now))
        self.assertTrue(scheduler_due({"enabled": True, "next_scan_at": None}, now))
        self.assertTrue(scheduler_due({"enabled": True, "next_scan_at": now - timedelta(seconds=1)}, now))
        self.assertFalse(scheduler_due({"enabled": True, "next_scan_at": now + timedelta(minutes=1)}, now))

    def test_process_inbox_import_runs_archive_file_and_completes_row(self) -> None:
        settings = SimpleNamespace(archive_dir=Path("/app/archive"))
        row = {"file_path": "/app/archive/inbox/tweets.txt", "file_type": "urls"}
        workflow_result = {"imported": 2}

        with (
            patch("xarchiver.services.inbox.claim_import", return_value=row),
            patch("pathlib.Path.exists", return_value=True),
            patch("pathlib.Path.is_file", return_value=True),
            patch("xarchiver.services.inbox.create_archive_run", return_value=7),
            patch("xarchiver.services.inbox.run_archive_file", return_value=workflow_result) as run_archive,
            patch("xarchiver.services.inbox.finish_import") as finish,
            patch("xarchiver.services.inbox.finish_archive_run") as finish_run,
        ):
            result = process_inbox_import(3, settings)

        self.assertEqual(
            result,
            {"id": 3, "archive_run_id": 7, "status": "completed", "result": workflow_result},
        )
        run_archive.assert_called_once_with(Path("/app/archive/inbox/tweets.txt"), settings, None)
        finish.assert_called_once_with(3, "completed", workflow_result, None)
        finish_run.assert_called_once_with(7, "completed", workflow_result, None)


if __name__ == "__main__":
    unittest.main()
