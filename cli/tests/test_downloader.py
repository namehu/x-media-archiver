import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from xarchiver.downloader import build_command, classify_error, fetch_download_candidates, format_sleep_range, validate_cookie_file
from xarchiver.db import connect


class DownloaderTests(unittest.TestCase):
    def test_validate_cookie_file_reports_missing_for_yt_dlp(self) -> None:
        self.assertEqual(validate_cookie_file("yt-dlp", Path("missing-cookies.txt")), "cookie_missing")

    def test_validate_cookie_file_ignores_gallery_dl(self) -> None:
        self.assertIsNone(validate_cookie_file("gallery-dl", Path("missing-cookies.txt")))

    def test_validate_cookie_file_reports_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cookie_file = Path(tmp) / "cookies.txt"
            cookie_file.write_text("", encoding="utf-8")
            self.assertEqual(validate_cookie_file("yt-dlp", cookie_file), "cookie_empty")

    def test_classify_error_detects_auth_and_rate_limit(self) -> None:
        self.assertEqual(classify_error(1, "Login required to access this page"), "auth_required")
        self.assertEqual(classify_error(1, "HTTP Error 429: rate limited"), "rate_limited")

    def test_classify_error_detects_cookie_and_no_media(self) -> None:
        self.assertEqual(classify_error(1, "cookies file is invalid"), "auth_required")
        self.assertEqual(classify_error(0, "No results for this tweet"), "download_no_output")
        self.assertEqual(classify_error(1, "No video could be found in this tweet"), "unsupported_media")

    def test_classify_error_uses_queue_category_contract(self) -> None:
        self.assertEqual(classify_error(1, "HTTP Error 404: not found"), "invalid_url")
        self.assertEqual(classify_error(1, "Connection timed out"), "network_error")
        self.assertEqual(classify_error(2, "unexpected stderr"), "unknown")

    def test_format_sleep_range_normalizes_values(self) -> None:
        self.assertEqual(format_sleep_range(2, 6), "2-6")
        self.assertEqual(format_sleep_range(6, 2), "6")

    def test_gallery_dl_command_includes_request_sleep(self) -> None:
        settings = SimpleNamespace(
            archive_dir=Path("/app/archive"),
            downloader_sleep_min_seconds=2,
            downloader_sleep_max_seconds=6,
        )

        command = build_command("gallery-dl", settings, Path("/app/archive/raw/input.txt"))

        self.assertIn("--sleep-request", command)
        self.assertIn("2-6", command)

    def test_yt_dlp_command_includes_sleep_options(self) -> None:
        settings = SimpleNamespace(
            archive_dir=Path("/app/archive"),
            cookie_file=Path("/app/secrets/cookies.txt"),
            downloader_sleep_min_seconds=2,
            downloader_sleep_max_seconds=6,
        )

        with patch("xarchiver.downloader.shutil.copyfile"):
            command = build_command("yt-dlp", settings, Path("/app/archive/raw/input.txt"))

        self.assertIn("--sleep-requests", command)
        self.assertIn("--sleep-interval", command)
        self.assertIn("--max-sleep-interval", command)


class DownloadCandidateIntegrationTests(unittest.TestCase):
    tweet_ids = ["candidate-fixture-pending", "candidate-fixture-over-limit", "candidate-fixture-backoff"]

    def setUp(self) -> None:
        self.cleanup_db()
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into tweets (tweet_id, url, download_status, retry_count)
                    values (%s, %s, 'pending', 0)
                    """,
                    (self.tweet_ids[0], f"https://x.com/test/status/{self.tweet_ids[0]}"),
                )
                cur.execute(
                    """
                    insert into tweets (tweet_id, url, download_status, retry_count, last_attempt_at)
                    values (%s, %s, 'failed_retryable', 3, now() - interval '1 day')
                    """,
                    (self.tweet_ids[1], f"https://x.com/test/status/{self.tweet_ids[1]}"),
                )
                cur.execute(
                    """
                    insert into tweets (tweet_id, url, download_status, retry_count, last_attempt_at)
                    values (%s, %s, 'failed_retryable', 1, now())
                    """,
                    (self.tweet_ids[2], f"https://x.com/test/status/{self.tweet_ids[2]}"),
                )
            conn.commit()

    def tearDown(self) -> None:
        self.cleanup_db()

    def cleanup_db(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("delete from tweets where tweet_id = any(%s)", (self.tweet_ids,))
            conn.commit()

    def test_fetch_download_candidates_respects_retry_limit_and_backoff(self) -> None:
        tweet_ids = {
            row["tweet_id"]
            for row in fetch_download_candidates(limit=None, retry_limit=3, retry_backoff_minutes=15)
        }

        self.assertIn(self.tweet_ids[0], tweet_ids)
        self.assertNotIn(self.tweet_ids[1], tweet_ids)
        self.assertNotIn(self.tweet_ids[2], tweet_ids)

    def test_fetch_download_candidates_limits_query_to_scope(self) -> None:
        rows = fetch_download_candidates(
            limit=None,
            retry_limit=3,
            retry_backoff_minutes=15,
            tweet_ids=[self.tweet_ids[1]],
        )

        self.assertEqual(rows, [])


if __name__ == "__main__":
    unittest.main()
