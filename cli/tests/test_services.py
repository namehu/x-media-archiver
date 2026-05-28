import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from xarchiver.services.library import archive_relative_path, attach_media_url, get_summary, list_media


class LibraryServiceTests(unittest.TestCase):
    def test_archive_relative_path_accepts_container_and_host_archive_paths(self) -> None:
        self.assertEqual(
            archive_relative_path("/app/archive/media/alice/1.jpg", Path("/app/archive")),
            "media/alice/1.jpg",
        )
        self.assertEqual(
            archive_relative_path(
                "D:/B04_github/x-media-archiver/archive/media/alice/1.jpg",
                Path("/app/archive"),
            ),
            "media/alice/1.jpg",
        )

    def test_attach_media_url_adds_relative_api_url(self) -> None:
        row = attach_media_url({"local_path": "/app/archive/media/alice/1.jpg"}, Path("/app/archive"))

        self.assertEqual(row["media_relative_path"], "media/alice/1.jpg")
        self.assertEqual(row["media_url"], "/api/v1/media-file/media/alice/1.jpg")

    def test_get_summary_never_exposes_sensitive_settings(self) -> None:
        settings = SimpleNamespace(
            archive_dir=Path("/tmp/archive"),
            database_url="postgresql://secret",
            cookie_file=Path("/tmp/cookies.txt"),
        )
        with (
            patch("xarchiver.services.library.ensure_archive_dirs"),
            patch("xarchiver.services.library.get_status_counts", return_value={"verified": 2, "missing": 1}),
            patch("xarchiver.services.library.get_media_count", return_value=3),
            patch("xarchiver.services.library.list_recent_exports", return_value=[]),
        ):
            summary = get_summary(settings)

        self.assertEqual(summary["failure_count"], 1)
        self.assertNotIn("database_url", summary)
        self.assertNotIn("cookie_file", summary)

    def test_list_media_maps_all_status_to_unfiltered_query(self) -> None:
        settings = SimpleNamespace(archive_dir=Path("/app/archive"))
        with patch("xarchiver.services.library.search_media", return_value=[]) as search_media:
            rows = list_media(settings, media_status="all", limit=10)

        self.assertEqual(rows, [])
        search_media.assert_called_once_with(
            author=None,
            text=None,
            tweet_status=None,
            media_status=None,
            media_type=None,
            limit=10,
            offset=0,
        )


if __name__ == "__main__":
    unittest.main()
