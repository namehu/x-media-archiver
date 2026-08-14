import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import orjson

from xarchiver.downloader import sync_gallery_hashtags_after_backfill
from xarchiver.row_models import GalleryMetadataPathRow
from xarchiver.services.hashtags import (
    _read_metadata_observations,
    extract_gallery_dl_hashtags,
    gallery_dl_compatibility,
    normalize_hashtag,
    normalize_hashtag_query,
    resolve_registered_metadata_path,
)

FIXTURE_DIR = Path(__file__).parent / "fixtures"


class PlatformHashtagTests(unittest.TestCase):
    def test_normalization_uses_nfkc_casefold_and_optional_hash(self) -> None:
        self.assertEqual(normalize_hashtag("#ＡＩ"), ("ＡＩ", "ai"))
        self.assertEqual(normalize_hashtag("Straße"), ("Straße", "strasse"))
        self.assertEqual(normalize_hashtag_query(" #ＡＩ "), "ai")

    def test_normalization_rejects_non_strings_whitespace_controls_and_double_hash(self) -> None:
        self.assertIsNone(normalize_hashtag(123))
        self.assertIsNone(normalize_hashtag("two words"))
        self.assertIsNone(normalize_hashtag("bad\nvalue"))
        self.assertIsNone(normalize_hashtag("##nested"))

    def test_gallery_contract_fixture_preserves_first_spelling_position_and_top_level_only(self) -> None:
        metadata = orjson.loads((FIXTURE_DIR / "gallery-dl-v1.32.1-tweet.json").read_bytes())

        values, invalid_count = extract_gallery_dl_hashtags(metadata)
        nested, nested_invalid = extract_gallery_dl_hashtags(
            {"article": {"hashtags": ["NotTopLevel"]}}
        )

        self.assertEqual(
            [(value.display_name, value.normalized_name, value.position) for value in values],
            [("AI", "ai", 0), ("Science", "science", 1)],
        )
        self.assertEqual(invalid_count, 0)
        self.assertEqual(nested, [])
        self.assertEqual(nested_invalid, 0)

    def test_note_tweet_fixture_normalizes_unicode_and_missing_field_is_not_confirmed_empty(self) -> None:
        note = orjson.loads((FIXTURE_DIR / "gallery-dl-v1.32.1-note-tweet.json").read_bytes())
        no_hashtags = orjson.loads(
            (FIXTURE_DIR / "gallery-dl-v1.32.1-no-hashtags.json").read_bytes()
        )

        values, invalid_count = extract_gallery_dl_hashtags(note)
        missing, missing_invalid = extract_gallery_dl_hashtags(no_hashtags)

        self.assertEqual([value.normalized_name for value in values], ["ai", "量子物理"])
        self.assertEqual(invalid_count, 0)
        self.assertEqual(missing, [])
        self.assertEqual(missing_invalid, 0)

    def test_invalid_items_are_skipped_and_input_is_bounded(self) -> None:
        values, invalid_count = extract_gallery_dl_hashtags(
            {"hashtags": ["valid", None, "bad value", *[f"tag-{index}" for index in range(105)]]}
        )

        self.assertEqual(values[0].display_name, "valid")
        self.assertEqual(len(values), 98)
        self.assertEqual(invalid_count, 10)

    def test_registered_metadata_must_resolve_inside_archive_media(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            archive_dir = Path(tmp) / "archive"
            metadata_path = archive_dir / "media" / "author" / "1" / "asset.jpg.json"
            metadata_path.parent.mkdir(parents=True)
            metadata_path.write_text("{}", encoding="utf-8")

            resolved = resolve_registered_metadata_path(
                archive_dir,
                "/app/archive/media/author/1/asset.jpg.json",
            )
            escaped = resolve_registered_metadata_path(archive_dir, "../outside.json")

            self.assertEqual(resolved, metadata_path.resolve())
            self.assertIsNone(escaped)

    def test_registered_file_requires_matching_tweet_id_and_reads_top_level_hashtags(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            archive_dir = Path(tmp) / "archive"
            metadata_path = archive_dir / "media" / "author" / "123" / "asset.jpg.json"
            metadata_path.parent.mkdir(parents=True)
            metadata_path.write_bytes(
                orjson.dumps({"tweet_id": "123", "hashtags": ["AI", "Science"]})
            )
            row = GalleryMetadataPathRow(
                id=1,
                tweet_id="123",
                metadata_path=metadata_path.as_posix(),
            )

            result = _read_metadata_observations(archive_dir, row)
            mismatch = _read_metadata_observations(
                archive_dir,
                row.model_copy(update={"tweet_id": "999"}),
            )

            self.assertEqual(result["status"], "valid")
            self.assertEqual(
                [value.display_name for value in result["observations"]],
                ["AI", "Science"],
            )
            self.assertEqual(mismatch["status"], "invalid_file")

    def test_gallery_version_status_is_non_blocking(self) -> None:
        with patch("xarchiver.services.hashtags.version", return_value="99.0.0"):
            result = gallery_dl_compatibility()

        self.assertEqual(result["validation_status"], "unverified")
        self.assertEqual(result["warning_code"], "gallery_dl_unverified")

    def test_incremental_hashtag_failure_does_not_escape_or_mutate_media_result(self) -> None:
        backfill_result = {"tweet_ids": ["123"], "media_ids": [9]}
        with (
            patch(
                "xarchiver.downloader.sync_registered_gallery_hashtags",
                side_effect=RuntimeError("hashtag database unavailable"),
            ),
            patch("xarchiver.downloader.append_download_log") as append_log,
        ):
            result = sync_gallery_hashtags_after_backfill(
                SimpleNamespace(archive_dir=Path("/app/archive")),
                "gallery-dl",
                backfill_result,
                91,
            )

        self.assertIsNone(result)
        self.assertEqual(backfill_result, {"tweet_ids": ["123"], "media_ids": [9]})
        self.assertEqual(append_log.call_args.args[1], "warning")

    def test_yt_dlp_backfill_never_attempts_platform_hashtag_extraction(self) -> None:
        backfill_result = {"tweet_ids": ["123"], "media_ids": [9]}
        with (
            patch("xarchiver.downloader.sync_registered_gallery_hashtags") as sync_hashtags,
            patch("xarchiver.downloader.gallery_dl_compatibility") as compatibility,
        ):
            result = sync_gallery_hashtags_after_backfill(
                SimpleNamespace(archive_dir=Path("/app/archive")),
                "yt-dlp",
                backfill_result,
                91,
            )

        self.assertIsNone(result)
        sync_hashtags.assert_not_called()
        compatibility.assert_not_called()

    def test_hashtag_sync_and_log_double_failure_never_escape_to_download(self) -> None:
        backfill_result = {"tweet_ids": ["123"], "media_ids": [9]}
        with (
            patch(
                "xarchiver.downloader.sync_registered_gallery_hashtags",
                side_effect=RuntimeError("hashtag database unavailable"),
            ),
            patch(
                "xarchiver.downloader.append_download_log",
                side_effect=RuntimeError("operation log unavailable"),
            ),
        ):
            result = sync_gallery_hashtags_after_backfill(
                SimpleNamespace(archive_dir=Path("/app/archive")),
                "gallery-dl",
                backfill_result,
                91,
            )

        self.assertIsNone(result)
        self.assertEqual(backfill_result, {"tweet_ids": ["123"], "media_ids": [9]})

    def test_successful_hashtag_sync_survives_info_log_failure(self) -> None:
        backfill_result = {"tweet_ids": ["123"], "media_ids": [9]}
        hashtag_result = {
            "observed_hashtag_count": 1,
            "inserted_relationship_count": 1,
            "invalid_hashtag_count": 0,
        }
        with (
            patch(
                "xarchiver.downloader.sync_registered_gallery_hashtags",
                return_value=hashtag_result,
            ),
            patch(
                "xarchiver.downloader.append_download_log",
                side_effect=RuntimeError("operation log unavailable"),
            ),
        ):
            result = sync_gallery_hashtags_after_backfill(
                SimpleNamespace(archive_dir=Path("/app/archive")),
                "gallery-dl",
                backfill_result,
                91,
            )

        self.assertEqual(result, hashtag_result)


if __name__ == "__main__":
    unittest.main()
