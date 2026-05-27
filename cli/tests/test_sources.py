import unittest

from xarchiver.services.sources import (
    build_gallery_dl_scan_url,
    build_scan_range,
    format_sleep_range,
    infer_author_username,
    is_source_scan_complete,
    merge_discovery_payload,
    normalize_source_type,
    normalize_source_url,
    parse_gallery_dl_records,
)


class SourceServiceTests(unittest.TestCase):
    def test_normalize_source_type_rejects_unknown_type(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalid_source_type"):
            normalize_source_type("timeline")

    def test_normalize_source_url_rejects_non_x_url(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalid_source_url"):
            normalize_source_url("https://example.com/user")

    def test_infer_author_username_for_media_url(self) -> None:
        self.assertEqual(
            infer_author_username("user_media", "https://x.com/example/media"),
            "example",
        )

    def test_infer_author_username_ignores_non_profile_sources(self) -> None:
        self.assertIsNone(infer_author_username("search", "https://x.com/search?q=test"))

    def test_parse_gallery_dl_records_extracts_unique_tweets(self) -> None:
        stdout = """
        [
          [2, {"tweet_id": 123, "content": "hello", "date": "2026-05-27 01:02:03",
               "author": {"name": "alice", "nick": "Alice"}}],
          [3, "https://pbs.twimg.com/media/test.jpg", {"tweet_id": 123,
               "author": {"name": "alice", "nick": "Alice"}, "type": "photo"}],
          [3, "https://video.twimg.com/ext_tw_video/test.mp4", {"tweet_id": 123,
               "author": {"name": "alice", "nick": "Alice"}, "type": "video"}],
          [2, {"tweet_id": 456, "author": {"name": "bob"}}]
        ]
        """

        rows = parse_gallery_dl_records(stdout, "https://x.com/alice/media")

        self.assertEqual([row["tweet_id"] for row in rows], ["123", "456"])
        self.assertEqual(rows[0]["url"], "https://x.com/alice/status/123")
        self.assertEqual(rows[0]["text"], "hello")
        self.assertIn("collected_at", rows[0])
        self.assertEqual(rows[0]["media_count"], 2)
        self.assertEqual(rows[0]["media_types"], ["photo", "video"])
        self.assertTrue(rows[0]["has_photo"])
        self.assertTrue(rows[0]["has_video"])
        self.assertEqual(rows[1]["media_count"], 0)

    def test_build_gallery_dl_scan_url_uses_timeline_for_profile(self) -> None:
        self.assertEqual(
            build_gallery_dl_scan_url("profile", "https://x.com/earthcurated"),
            "https://x.com/earthcurated/timeline",
        )

    def test_build_scan_range_advances_from_cursor(self) -> None:
        self.assertEqual(
            build_scan_range({"next_start_index": 21}, 20),
            {"start": 21, "end": 40, "limit": 20},
        )

    def test_build_scan_range_can_restart_from_latest(self) -> None:
        self.assertEqual(
            build_scan_range({"next_start_index": 101}, 10, restart=True),
            {"start": 1, "end": 10, "limit": 10},
        )

    def test_scan_complete_only_when_successful_range_returns_no_tweets(self) -> None:
        self.assertFalse(is_source_scan_complete({"exit_code": 0}, {"limit": 20}, 14))
        self.assertFalse(is_source_scan_complete({"exit_code": 0}, {"limit": 20}, 20))
        self.assertTrue(is_source_scan_complete({"exit_code": 0}, {"limit": 20}, 0))
        self.assertFalse(is_source_scan_complete({"exit_code": 1}, {"limit": 20}, 0))

    def test_format_sleep_range_normalizes_values(self) -> None:
        self.assertEqual(format_sleep_range(20, 45), "20-45")
        self.assertEqual(format_sleep_range(45, 20), "20-45")

    def test_merge_discovery_payload_retains_media_across_ranges(self) -> None:
        merged = merge_discovery_payload(
            {"media_items": [{"type": "photo", "url": "photo-1"}]},
            {"media_items": [{"type": "photo", "url": "photo-2"}], "tweet_id": "123"},
        )

        self.assertEqual(merged["media_count"], 2)
        self.assertEqual(merged["media_types"], ["photo"])


if __name__ == "__main__":
    unittest.main()
