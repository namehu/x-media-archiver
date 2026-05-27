import unittest
from pathlib import Path
from unittest.mock import patch

from typer.testing import CliRunner

from xarchiver.cli import app


class CliQueueTests(unittest.TestCase):
    def test_archive_urls_submits_batch_without_running_downloader(self) -> None:
        result_value = {"run_id": 4, "status": "queued", "tasks": {"queued_count": 1}}
        with patch("xarchiver.cli.submit_urls_file", return_value=result_value) as submit:
            result = CliRunner().invoke(app, ["archive-urls", "tweets.txt"])

        self.assertEqual(result.exit_code, 0)
        submit.assert_called_once_with(Path("tweets.txt"))
        self.assertIn("serve", result.output)

    def test_archive_jsonl_submits_through_same_queue_entry(self) -> None:
        with patch("xarchiver.cli.submit_jsonl_file", return_value={"run_id": 5, "status": "queued"}):
            result = CliRunner().invoke(app, ["archive-jsonl", "tweets.jsonl"])

        self.assertEqual(result.exit_code, 0)
        self.assertIn("serve", result.output)
