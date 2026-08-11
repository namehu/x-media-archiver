import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from xarchiver.row_models import ArchiveRunRow, TweetMediaAssetRow
from xarchiver.services.library import (
    archive_relative_path,
    attach_media_url,
    get_summary,
    list_media,
)


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
        self.assertEqual(row["preview_relative_path"], "media/alice/1.jpg")
        self.assertEqual(row["preview_url"], "/api/v1/media-file/media/alice/1.jpg")

    def test_attach_media_url_accepts_row_model(self) -> None:
        row = TweetMediaAssetRow.model_validate(
            {
                "id": 1,
                "media_status": "verified",
                "local_path": "/app/archive/media/alice/1.jpg",
                "updated_at": datetime(2026, 1, 1, tzinfo=UTC),
            }
        )

        result = attach_media_url(row, Path("/app/archive"))

        self.assertEqual(result["media_relative_path"], "media/alice/1.jpg")
        self.assertEqual(result["media_url"], "/api/v1/media-file/media/alice/1.jpg")

    def test_attach_media_url_uses_versioned_video_preview_when_present(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            archive_dir = Path(tmp)
            media_path = archive_dir / "media" / "alice" / "1.mp4"
            preview_path = media_path.with_name("1.preview.jpg")
            media_path.parent.mkdir(parents=True)
            media_path.write_bytes(b"video")
            preview_path.write_bytes(b"preview")

            result = attach_media_url(
                {"local_path": str(media_path), "media_type": "video"},
                archive_dir,
            )

            self.assertEqual(result["preview_relative_path"], "media/alice/1.preview.jpg")
            self.assertRegex(
                str(result["preview_url"]),
                r"^/api/v1/media-file/media/alice/1\.preview\.jpg\?v=[0-9a-f]+-[0-9a-f]+$",
            )

    def test_attach_media_url_does_not_fall_back_to_video_file(self) -> None:
        result = attach_media_url(
            {"local_path": "/app/archive/media/alice/1.mp4", "media_type": "video"},
            Path("/app/archive"),
        )

        self.assertIsNone(result["preview_relative_path"])
        self.assertIsNone(result["preview_url"])

    def test_archive_run_row_supports_dict_style_access(self) -> None:
        row = ArchiveRunRow.model_validate(
            {
                "id": 1,
                "trigger_type": "manual",
                "status": "queued",
                "started_at": datetime(2026, 1, 1, tzinfo=UTC),
                "result": {"tasks": {"queued_count": 1}},
            }
        )

        self.assertEqual(row["id"], 1)
        self.assertEqual(row.get("status"), "queued")
        self.assertEqual(dict(row)["result"], {"tasks": {"queued_count": 1}})

    def test_get_summary_never_exposes_sensitive_settings(self) -> None:
        settings = SimpleNamespace(
            archive_dir=Path("/tmp/archive"),
            database_url="postgresql://secret",
            cookie_file=Path("/tmp/cookies.txt"),
        )
        with (
            patch("xarchiver.services.library.ensure_archive_dirs"),
            patch("xarchiver.services.library.get_status_counts", return_value={"verified": 2, "missing": 1}),
            patch("xarchiver.services.library.count_failure_rows", return_value=1),
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
            author_username=None,
        )


if __name__ == "__main__":
    unittest.main()
