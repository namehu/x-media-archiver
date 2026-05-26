import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from typer.testing import CliRunner

from xarchiver.cli import app
from xarchiver.exporter import export_media_gallery, relative_archive_path


class ExporterTests(unittest.TestCase):
    def test_relative_archive_path_from_container_archive_dir(self) -> None:
        self.assertEqual(
            relative_archive_path("/app/archive/media/user/tweet/file.jpg", Path("/app/archive")),
            "media/user/tweet/file.jpg",
        )

    def test_relative_archive_path_from_nested_archive_marker(self) -> None:
        self.assertEqual(
            relative_archive_path(
                "D:/B04_github/x-media-archiver/archive/media/user/tweet/file.jpg",
                Path("/app/archive"),
            ),
            "media/user/tweet/file.jpg",
        )

    def test_gallery_escapes_content_and_previews_images_and_videos(self) -> None:
        with TemporaryDirectory() as tmp:
            archive_dir = Path(tmp) / "archive"
            output_path = archive_dir / "exports" / "gallery.html"
            rows = [
                {
                    "tweet_url": 'https://x.test/status/1?q=<script>&quote="',
                    "author_username": "alice<script>",
                    "author_display_name": "Alice & Co",
                    "tweet_text": "<script>alert('x')</script> & text",
                    "published_at": "2026-05-26",
                    "media_type": "photo",
                    "media_status": "verified",
                    "local_path": archive_dir / "media" / "alice" / "image & one.jpg",
                    "file_ext": "jpg",
                },
                {
                    "tweet_url": "https://x.test/status/2",
                    "author_username": "alice",
                    "tweet_text": "clip",
                    "media_type": "video",
                    "media_status": "verified",
                    "local_path": archive_dir / "media" / "alice" / "movie.mp4",
                    "file_ext": "mp4",
                },
            ]
            with patch("xarchiver.exporter.fetch_export_rows", return_value=rows) as fetch_rows:
                result = export_media_gallery(archive_dir, output_path)

            html = output_path.read_text(encoding="utf-8")
            fetch_rows.assert_called_once_with("verified")
            self.assertEqual(result["rows"], 2)
            self.assertIn('src="../media/alice/image%20%26%20one.jpg"', html)
            self.assertIn('<video class="preview" src="../media/alice/movie.mp4"', html)
            self.assertIn("&lt;script&gt;alert(&#x27;x&#x27;)&lt;/script&gt; &amp; text", html)
            self.assertIn("alice&lt;script&gt;", html)
            self.assertIn(
                'href="https://x.test/status/1?q=&lt;script&gt;&amp;quote=&quot;"',
                html,
            )
            self.assertNotIn("<script>", html)

    def test_export_gallery_command_maps_all_status_to_unfiltered_export(self) -> None:
        runner = CliRunner()
        settings = SimpleNamespace(archive_dir=Path("archive"))
        with (
            patch("xarchiver.cli.get_settings", return_value=settings),
            patch(
                "xarchiver.cli.export_media_gallery",
                return_value={"path": "gallery.html", "rows": 0, "status": "all"},
            ) as export_gallery,
        ):
            result = runner.invoke(
                app,
                ["export-gallery", "--status", "all", "--output", "gallery.html"],
            )

        self.assertEqual(result.exit_code, 0, result.output)
        export_gallery.assert_called_once_with(
            settings.archive_dir,
            Path("gallery.html"),
            None,
        )


if __name__ == "__main__":
    unittest.main()
