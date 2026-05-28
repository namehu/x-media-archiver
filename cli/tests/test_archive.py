import tempfile
import unittest
from pathlib import Path

from xarchiver.archive import ARCHIVE_SUBDIRS, ensure_archive_dirs, normalize_path


class ArchiveServiceTests(unittest.TestCase):
    def test_ensure_archive_dirs_creates_required_subdirectories(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            archive_dir = Path(tmp) / "archive"

            ensure_archive_dirs(archive_dir)

            self.assertTrue(archive_dir.is_dir())
            for subdir in ARCHIVE_SUBDIRS:
                self.assertTrue((archive_dir / subdir).is_dir(), subdir)

    def test_ensure_archive_dirs_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            archive_dir = Path(tmp) / "archive"

            ensure_archive_dirs(archive_dir)
            ensure_archive_dirs(archive_dir)

            self.assertTrue((archive_dir / "media").is_dir())

    def test_normalize_path_uses_posix_separators(self) -> None:
        self.assertEqual(normalize_path(Path("archive") / "media" / "alice"), "archive/media/alice")


if __name__ == "__main__":
    unittest.main()
