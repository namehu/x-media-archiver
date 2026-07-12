import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from xarchiver.core.errors import ErrorCategory, classify_x_error
from xarchiver.db import connect
from xarchiver.downloader import (
    build_command,
    classify_error,
    estimate_downloaded_bytes_by_tweet,
    fetch_download_candidates,
    format_sleep_range,
    parse_downloader_progress,
    prepare_cookies,
    validate_cookie_file,
)


class DownloaderTests(unittest.TestCase):
    def test_validate_cookie_file_reports_missing_for_yt_dlp(self) -> None:
        self.assertEqual(validate_cookie_file("yt-dlp", Path("missing-cookies.txt")), "cookie_missing")

    def test_validate_cookie_file_reports_missing_for_gallery_dl(self) -> None:
        self.assertEqual(validate_cookie_file("gallery-dl", Path("missing-cookies.txt")), "cookie_missing")

    def test_validate_cookie_file_reports_missing_for_none_path(self) -> None:
        self.assertEqual(validate_cookie_file("yt-dlp", None), "cookie_missing")

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

    def test_core_error_classifier_is_single_source_for_x_errors(self) -> None:
        self.assertEqual(classify_x_error("HTTP Error 429: rate limited"), ErrorCategory.RATE_LIMITED)
        self.assertEqual(classify_x_error("No media found"), ErrorCategory.UNSUPPORTED_MEDIA)

    def test_format_sleep_range_normalizes_values(self) -> None:
        self.assertEqual(format_sleep_range(0, 3), "0-3")
        self.assertEqual(format_sleep_range(6, 2), "6")

    def test_gallery_dl_command_includes_request_sleep(self) -> None:
        settings = SimpleNamespace(
            archive_dir=Path("/app/archive"),
            downloader_sleep_min_seconds=0,
            downloader_sleep_max_seconds=3,
        )

        command = build_command(
            "gallery-dl",
            settings,
            Path("/app/archive/raw/input.txt"),
            Path("/app/archive/state/runtime-cookies.txt"),
        )

        self.assertIn("--sleep-request", command)
        self.assertIn("0-3", command)
        self.assertIn("extractor.twitter.cookies=/app/archive/state/runtime-cookies.txt", command)
        self.assertIn("extractor.twitter.cookies-update=false", command)

    def test_yt_dlp_command_includes_sleep_options(self) -> None:
        settings = SimpleNamespace(
            archive_dir=Path("/app/archive"),
            downloader_sleep_min_seconds=0,
            downloader_sleep_max_seconds=3,
        )

        command = build_command(
            "yt-dlp",
            settings,
            Path("/app/archive/raw/input.txt"),
            Path("/app/archive/state/runtime-cookies.txt"),
        )

        self.assertIn("--sleep-requests", command)
        self.assertIn("--sleep-interval", command)
        self.assertIn("--max-sleep-interval", command)
        self.assertIn("/app/archive/state/runtime-cookies.txt", command)

    def test_yt_dlp_command_includes_native_progress_template(self) -> None:
        settings = SimpleNamespace(
            archive_dir=Path("/app/archive"),
            downloader_sleep_min_seconds=0,
            downloader_sleep_max_seconds=3,
        )

        command = build_command(
            "yt-dlp",
            settings,
            Path("/app/archive/raw/input.txt"),
            Path("/app/archive/state/runtime-cookies.txt"),
        )

        self.assertIn("--newline", command)
        self.assertIn("--no-color", command)
        self.assertIn("--progress-template", command)
        template = next(value for value in command if "xarchiver-progress:" in value)
        self.assertIn("%(info.id)s", template)

    def test_parse_downloader_progress_reads_yt_dlp_template_output(self) -> None:
        progress = parse_downloader_progress("xarchiver-progress:123|downloading|2048|4096|8192|512")

        self.assertEqual(
            progress,
            {"tweet_id": "123", "downloaded_bytes": 2048, "total_bytes": 4096, "speed_bps": 512},
        )

    def test_parse_downloader_progress_uses_estimated_total(self) -> None:
        progress = parse_downloader_progress("xarchiver-progress:123|downloading|2048|NA|8192|512")

        self.assertEqual(progress["total_bytes"], 8192)

    def test_estimate_downloaded_bytes_groups_files_by_exact_tweet_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            archive_dir = Path(tmp)
            first = archive_dir / "media" / "author" / "123"
            second = archive_dir / "media" / "author" / "1234"
            first.mkdir(parents=True)
            second.mkdir(parents=True)
            (first / "photo.jpg").write_bytes(b"123")
            (first / "video.part").write_bytes(b"12345")
            (first / "metadata.json").write_bytes(b"ignored")
            (second / "video.mp4").write_bytes(b"1234567")

            sizes = estimate_downloaded_bytes_by_tweet(archive_dir, ["123", "1234"])

        self.assertEqual(sizes, {"123": 8, "1234": 7})

    def test_prepare_cookies_writes_file_fallback_to_runtime_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cookie_file = root / "secrets" / "cookies.txt"
            cookie_file.parent.mkdir()
            cookie_file.write_text("# Netscape\n.example\tTRUE\t/\tTRUE\t0\tname\tvalue\n", encoding="utf-8")
            settings = SimpleNamespace(archive_dir=root / "archive", cookie_file=cookie_file)

            with patch("xarchiver.downloader.resolve_cookie_content") as mock:
                mock.return_value = SimpleNamespace(content=cookie_file.read_text(encoding="utf-8"))
                runtime_path = prepare_cookies(settings)

            self.assertEqual(runtime_path, root / "archive" / "state" / "runtime-cookies.txt")
            self.assertIn("name\tvalue", runtime_path.read_text(encoding="utf-8"))


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
