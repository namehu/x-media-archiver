import unittest
from pathlib import Path

from xarchiver.exporter import relative_archive_path


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


if __name__ == "__main__":
    unittest.main()
