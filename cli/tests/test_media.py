import tempfile
import unittest
from pathlib import Path

import orjson

from xarchiver.media import asset_from_gallery_dl_metadata, asset_from_yt_dlp_metadata


class MediaMetadataTests(unittest.TestCase):
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
                "_type": "video",
                "width": 1920,
                "height": 1080,
                "duration": 1.5,
            }
            metadata_path.write_bytes(orjson.dumps(metadata))

            asset = asset_from_yt_dlp_metadata(media_dir, metadata_path, metadata, normalize_files=True)

            self.assertIsNotNone(asset)
            assert asset is not None
            self.assertEqual(asset.tweet_id, "tweet-id")
            self.assertEqual(asset.author_username, "author")
            self.assertEqual(asset.media_type, "video")
            self.assertEqual(asset.duration_ms, 1500)
            self.assertEqual(asset.source_engine, "yt-dlp")
            self.assertEqual(asset.local_path, media_dir / "author" / "tweet-id" / "tweet-id--m1.mp4")
            self.assertTrue(asset.local_path.exists())


if __name__ == "__main__":
    unittest.main()
