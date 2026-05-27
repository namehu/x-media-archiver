import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from xarchiver.importer import extract_tweet_id, import_urls_scoped


class ImporterTests(unittest.TestCase):
    def test_extract_tweet_id_from_x_status_url(self) -> None:
        self.assertEqual(
            extract_tweet_id("https://x.com/PhysInHistory/status/2058554692586885322"),
            "2058554692586885322",
        )

    def test_extract_tweet_id_strips_query(self) -> None:
        self.assertEqual(
            extract_tweet_id("https://twitter.com/user/status/1234567890?s=20"),
            "1234567890",
        )

    def test_extract_tweet_id_rejects_profile_url(self) -> None:
        with self.assertRaises(ValueError):
            extract_tweet_id("https://x.com/XiangHupt/likes")

    def test_import_urls_scoped_counts_existing_and_duplicate_input(self) -> None:
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "tweets.txt"
            path.write_text(
                "https://x.com/u/status/1\nhttps://x.com/u/status/1\nhttps://x.com/u/status/2\n",
                encoding="utf-8",
            )
            with (
                patch("xarchiver.importer.fetch_existing_tweet_statuses", return_value={"1": "verified"}),
                patch("xarchiver.importer.upsert_tweets"),
            ):
                result = import_urls_scoped(path)

        self.assertEqual(result["input_record_count"], 3)
        self.assertEqual(result["unique_tweet_count"], 2)
        self.assertEqual(result["duplicate_input_count"], 1)
        self.assertEqual(result["existing_tweet_count"], 1)
        self.assertEqual(result["skipped_existing_count"], 1)


if __name__ == "__main__":
    unittest.main()
