import tempfile
import unittest
from pathlib import Path

from xarchiver.downloader import classify_error, validate_cookie_file


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
        self.assertEqual(classify_error(1, "cookies file is invalid"), "cookie_invalid")
        self.assertEqual(classify_error(0, "No results for this tweet"), "no_media")


if __name__ == "__main__":
    unittest.main()
