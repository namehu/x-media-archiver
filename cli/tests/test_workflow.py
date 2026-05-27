import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from xarchiver.workflow import archive_urls, summarize_download_result
from xarchiver.services.runs import run_archive_file


class WorkflowTests(unittest.TestCase):
    def test_summarize_download_result_keeps_compact_fields(self) -> None:
        self.assertEqual(
            summarize_download_result(
                {
                    "job_id": 12,
                    "count": 3,
                    "exit_code": 0,
                    "input_path": "/tmp/input.txt",
                    "media_backfill": {"upserted": 2},
                }
            ),
            {
                "job_id": 12,
                "count": 3,
                "exit_code": 0,
                "media_backfill": {"upserted": 2},
            },
        )

    def test_run_archive_file_uses_jsonl_pipeline_for_jsonl_input(self) -> None:
        settings = SimpleNamespace()
        with patch("xarchiver.services.runs.archive_jsonl", return_value={"input_type": "jsonl"}) as archive_jsonl:
            result = run_archive_file(Path("tweets.jsonl"), settings)

        self.assertEqual(result, {"input_type": "jsonl"})
        archive_jsonl.assert_called_once_with(Path("tweets.jsonl"), settings, None)

    def test_archive_urls_recovers_interrupted_runs_before_import(self) -> None:
        settings = SimpleNamespace(stuck_timeout_minutes=120)
        with (
            patch("xarchiver.workflow.recover_interrupted_runs") as recover,
            patch("xarchiver.workflow.import_urls", side_effect=ValueError("bad input")),
        ):
            with self.assertRaisesRegex(ValueError, "bad input"):
                archive_urls(Path("tweets.txt"), settings)

        recover.assert_called_once_with(120)


if __name__ == "__main__":
    unittest.main()
