import tempfile
import unittest
from os import utime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import orjson

from xarchiver.media import (
    asset_from_gallery_dl_metadata,
    asset_from_yt_dlp_metadata,
    ensure_video_preview,
    ensure_video_previews,
    iter_metadata_paths,
    safe_path_segment,
    video_preview_path,
)


class MediaMetadataTests(unittest.TestCase):
    def test_scoped_metadata_paths_only_include_selected_tweet(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            media_dir = Path(tmp) / "media"
            first = media_dir / "author" / "tweet-1" / "one.json"
            second = media_dir / "author" / "tweet-2" / "two.json"
            first.parent.mkdir(parents=True)
            second.parent.mkdir(parents=True)
            first.write_text("{}", encoding="utf-8")
            second.write_text("{}", encoding="utf-8")

            paths = iter_metadata_paths(media_dir, ["tweet-1"])

            self.assertEqual(paths, [first])

    def test_gallery_dl_metadata_maps_to_media_asset(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            metadata_path = Path(tmp) / "123--m1.jpg.json"
            media_path = Path(tmp) / "123--m1.jpg"
            media_path.write_bytes(b"image")
            metadata = {
                "tweet_id": 123,
                "type": "photo",
                "num": 1,
                "width": 1200,
                "height": 800,
                "content": "tweet body",
                "date": "2026-05-24 07:16:12",
                "author": {"name": "author", "nick": "Author Name"},
            }
            metadata_path.write_bytes(orjson.dumps(metadata))

            asset = asset_from_gallery_dl_metadata(metadata_path, metadata)

            self.assertIsNotNone(asset)
            assert asset is not None
            self.assertEqual(asset.tweet_id, "123")
            self.assertEqual(asset.author_username, "author")
            self.assertEqual(asset.media_type, "photo")
            self.assertEqual(asset.media_index, 1)
            self.assertEqual(asset.width, 1200)
            self.assertEqual(asset.height, 800)
            self.assertEqual(asset.tweet_text, "tweet body")
            self.assertEqual(asset.published_at, "2026-05-24T07:16:12+00:00")
            self.assertEqual(asset.source_engine, "gallery-dl")

    def test_yt_dlp_metadata_uses_display_id_for_tweet_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            media_dir = Path(tmp) / "media"
            source_dir = media_dir / "author" / "video-internal-id"
            source_dir.mkdir(parents=True)
            media_path = source_dir / "video-internal-id.mp4"
            metadata_path = source_dir / "video-internal-id.info.json"
            media_path.write_bytes(b"video")
            metadata = {
                "id": "video-internal-id",
                "display_id": "tweet-id",
                "uploader_id": "author",
                "uploader": "Author Name",
                "description": "video tweet body",
                "_type": "video",
                "width": 1920,
                "height": 1080,
                "duration": 1.5,
                "timestamp": 1779727042,
            }
            metadata_path.write_bytes(orjson.dumps(metadata))

            asset = asset_from_yt_dlp_metadata(media_dir, metadata_path, metadata, normalize_files=True)

            self.assertIsNotNone(asset)
            assert asset is not None
            self.assertEqual(asset.tweet_id, "tweet-id")
            self.assertEqual(asset.author_username, "author")
            self.assertEqual(asset.media_type, "video")
            self.assertEqual(asset.duration_ms, 1500)
            self.assertEqual(asset.tweet_text, "video tweet body")
            self.assertEqual(asset.published_at, "2026-05-25T16:37:22+00:00")
            self.assertEqual(asset.source_engine, "yt-dlp")
            self.assertEqual(asset.local_path, media_dir / "author" / "tweet-id" / "tweet-id--p1.mp4")
            self.assertTrue(asset.local_path.exists())

    def test_safe_path_segment_removes_path_unsafe_characters(self) -> None:
        self.assertEqual(safe_path_segment("user/name:with*chars"), "user_name_with_chars")
        self.assertEqual(safe_path_segment(""), "_unknown")

    def test_video_preview_prefers_existing_thumbnail(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            media_path = Path(tmp) / "video.mp4"
            thumbnail_path = Path(tmp) / "video.thumb.jpg"
            media_path.write_bytes(b"video")
            thumbnail_path.write_bytes(b"thumbnail")

            def create_preview(command: list[str], **_kwargs: object) -> SimpleNamespace:
                Path(command[-1]).write_bytes(b"preview")
                return SimpleNamespace(returncode=0)

            with patch("xarchiver.media.subprocess.run", side_effect=create_preview) as run:
                status = ensure_video_preview(media_path)

            self.assertEqual(status, "generated")
            self.assertEqual(video_preview_path(media_path).read_bytes(), b"preview")
            self.assertIn(str(thumbnail_path), run.call_args.args[0])
            self.assertNotIn("-ss", run.call_args.args[0])

    def test_video_preview_retries_from_first_frame(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            media_path = Path(tmp) / "short.mp4"
            media_path.write_bytes(b"video")
            calls = 0

            def create_on_second_attempt(command: list[str], **_kwargs: object) -> SimpleNamespace:
                nonlocal calls
                calls += 1
                if calls == 2:
                    Path(command[-1]).write_bytes(b"preview")
                    return SimpleNamespace(returncode=0)
                return SimpleNamespace(returncode=1)

            with patch("xarchiver.media.subprocess.run", side_effect=create_on_second_attempt) as run:
                status = ensure_video_preview(media_path)

            self.assertEqual(status, "generated")
            self.assertEqual(run.call_count, 2)
            self.assertIn("-ss", run.call_args_list[0].args[0])
            self.assertNotIn("-ss", run.call_args_list[1].args[0])

    def test_video_preview_is_idempotent_until_source_changes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            media_path = Path(tmp) / "video.mp4"
            preview_path = video_preview_path(media_path)
            media_path.write_bytes(b"video")
            preview_path.write_bytes(b"preview")
            utime(media_path, ns=(1, 1))
            utime(preview_path, ns=(2, 2))

            with patch("xarchiver.media.subprocess.run") as run:
                status = ensure_video_preview(media_path)

            self.assertEqual(status, "existing")
            run.assert_not_called()

            utime(media_path, ns=(3, 3))

            def rebuild_preview(command: list[str], **_kwargs: object) -> SimpleNamespace:
                Path(command[-1]).write_bytes(b"updated-preview")
                return SimpleNamespace(returncode=0)

            with patch("xarchiver.media.subprocess.run", side_effect=rebuild_preview):
                status = ensure_video_preview(media_path)

            self.assertEqual(status, "generated")
            self.assertEqual(preview_path.read_bytes(), b"updated-preview")

    def test_video_preview_batch_continues_after_individual_failure(self) -> None:
        assets = [
            SimpleNamespace(media_type="video", local_path=Path("first.mp4")),
            SimpleNamespace(media_type="video", local_path=Path("second.mp4")),
        ]
        with patch("xarchiver.media.ensure_video_preview", side_effect=["failed", "generated"]):
            result = ensure_video_previews(assets)

        self.assertEqual(result["preview_failed"], 1)
        self.assertEqual(result["preview_generated"], 1)
        self.assertEqual(result["preview_existing"], 0)

    def test_video_preview_failure_does_not_leave_temporary_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            media_path = Path(tmp) / "video.mp4"
            media_path.write_bytes(b"video")
            with patch(
                "xarchiver.media.subprocess.run",
                return_value=SimpleNamespace(returncode=1),
            ):
                status = ensure_video_preview(media_path)

            self.assertEqual(status, "failed")
            self.assertFalse(video_preview_path(media_path).exists())
            self.assertEqual(list(Path(tmp).glob("*.tmp.jpg")), [])


if __name__ == "__main__":
    unittest.main()
