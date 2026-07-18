import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from xarchiver.core.errors import ArchiverError
from xarchiver.services.media_deletion import (
    DeleteFile,
    MediaFileDeleteError,
    _collect_delete_files,
    _delete_files,
    _remove_empty_media_dirs,
    _safe_media_path,
)


class MediaDeletionFileTests(unittest.TestCase):
    def test_collects_and_deletes_media_metadata_and_thumbnail(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            archive_dir = Path(tmp)
            tweet_dir = archive_dir / "media" / "author" / "tweet"
            tweet_dir.mkdir(parents=True)
            media = tweet_dir / "tweet--p1.mp4"
            metadata = tweet_dir / "tweet--p1.info.json"
            thumbnail = tweet_dir / "tweet--p1.thumb.jpg"
            preview = tweet_dir / "tweet--p1.preview.jpg"
            for path, content in (
                (media, b"media"),
                (metadata, b"{}"),
                (thumbnail, b"thumb"),
                (preview, b"preview"),
            ):
                path.write_bytes(content)

            files = _collect_delete_files(
                archive_dir,
                [{"local_path": str(media), "metadata_path": str(metadata)}],
            )
            result = _delete_files(files)
            _remove_empty_media_dirs(archive_dir, files)

            self.assertEqual(result["deleted_file_count"], 4)
            self.assertEqual(result["deleted_bytes"], 19)
            self.assertEqual(result["missing_file_count"], 0)
            self.assertFalse(tweet_dir.exists())

    def test_missing_referenced_files_are_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            archive_dir = Path(tmp)
            (archive_dir / "media").mkdir()
            files = _collect_delete_files(
                archive_dir,
                [{"local_path": "media/a/t/missing.jpg", "metadata_path": "media/a/t/missing.jpg.json"}],
            )
            result = _delete_files(files)
            self.assertEqual(result["deleted_file_count"], 0)
            self.assertEqual(result["missing_file_count"], 2)

    def test_delete_error_reports_only_successfully_deleted_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            first = Path(tmp) / "first.jpg"
            second = Path(tmp) / "second.jpg"
            first.write_bytes(b"first")
            second.write_bytes(b"second")
            original_unlink = Path.unlink
            call_count = 0

            def fail_second_unlink(path: Path, *args: object, **kwargs: object) -> None:
                nonlocal call_count
                call_count += 1
                if call_count == 2:
                    raise PermissionError("test delete failure")
                original_unlink(path, *args, **kwargs)

            with patch.object(Path, "unlink", fail_second_unlink):
                with self.assertRaises(MediaFileDeleteError) as ctx:
                    _delete_files([DeleteFile(first, True), DeleteFile(second, True)])

            self.assertEqual(ctx.exception.partial_result["deleted_file_count"], 1)
            self.assertEqual(ctx.exception.partial_result["deleted_bytes"], 5)
            self.assertEqual(ctx.exception.partial_result["missing_file_count"], 0)
            self.assertFalse(first.exists())
            self.assertTrue(second.exists())

    def test_rejects_path_outside_media_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            archive_dir = Path(tmp)
            (archive_dir / "media").mkdir()
            with self.assertRaises(ArchiverError):
                _safe_media_path(archive_dir, "../outside.jpg")

    def test_rejects_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            archive_dir = Path(tmp)
            media_dir = archive_dir / "media"
            media_dir.mkdir()
            target = archive_dir / "outside.jpg"
            target.write_bytes(b"outside")
            link = media_dir / "link.jpg"
            try:
                link.symlink_to(target)
            except OSError:
                self.skipTest("symlinks are unavailable")
            with self.assertRaises(ArchiverError):
                _safe_media_path(archive_dir, link)


if __name__ == "__main__":
    unittest.main()
