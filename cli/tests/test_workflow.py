import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from xarchiver.workflow import archive_urls, process_tweet_scope, summarize_download_result


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

    def test_scoped_pipeline_links_downloads_to_archive_run_items(self) -> None:
        settings = SimpleNamespace()
        empty_download = {"job_id": 1, "count": 0, "media_backfill": {"media_ids": [], "tweet_ids": []}}
        with (
            patch("xarchiver.workflow.download", side_effect=[empty_download, empty_download]) as download,
            patch("xarchiver.workflow.verify_media_assets", return_value={"verified": 0, "missing": 0, "corrupt": 0}),
            patch("xarchiver.workflow.get_library_snapshot", return_value={"media_total": 0, "verified_total": 0}),
        ):
            process_tweet_scope(["1"], settings, archive_run_id=9, item_ids={"1": 13})

        self.assertEqual(download.call_args_list[0].kwargs["archive_run_id"], 9)
        self.assertEqual(download.call_args_list[0].kwargs["run_item_ids"], {"1": 13})

    def test_archive_urls_recovers_interrupted_runs_before_import(self) -> None:
        settings = SimpleNamespace(stuck_timeout_minutes=120)
        with (
            patch("xarchiver.workflow.recover_interrupted_runs") as recover,
            patch("xarchiver.workflow.import_urls_scoped", side_effect=ValueError("bad input")),
        ):
            with self.assertRaisesRegex(ValueError, "bad input"):
                archive_urls(Path("tweets.txt"), settings)

        recover.assert_called_once_with(120)

    def test_archive_urls_skips_full_library_work_for_verified_input(self) -> None:
        settings = SimpleNamespace(stuck_timeout_minutes=120)
        import_result = {
            "input_record_count": 4,
            "unique_tweet_count": 4,
            "tweet_ids": ["1", "2", "3", "4"],
            "new_tweet_count": 0,
            "existing_tweet_count": 4,
            "skipped_existing_count": 4,
            "duplicate_input_count": 0,
        }
        empty_download = {"job_id": 1, "count": 0, "media_backfill": {"media_ids": [], "tweet_ids": []}}
        with (
            patch("xarchiver.workflow.recover_interrupted_runs", return_value={}),
            patch("xarchiver.workflow.import_urls_scoped", return_value=import_result),
            patch("xarchiver.workflow.download", side_effect=[empty_download, empty_download]) as download,
            patch("xarchiver.workflow.verify_media_assets", return_value={"verified": 0, "missing": 0, "corrupt": 0}) as verify,
            patch("xarchiver.workflow.get_library_snapshot", return_value={"media_total": 5, "verified_total": 5}),
        ):
            result = archive_urls(Path("tweets.txt"), settings)

        self.assertEqual(result["pipeline_version"], "incremental-v1")
        self.assertEqual(result["media"]["verified_media_count"], 0)
        self.assertEqual(result["library_snapshot"]["verified_total"], 5)
        self.assertEqual(download.call_args_list[0].kwargs["tweet_ids"], ["1", "2", "3", "4"])
        verify.assert_called_once_with(media_ids=[])


if __name__ == "__main__":
    unittest.main()
