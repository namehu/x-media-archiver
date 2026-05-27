import unittest

from xarchiver.services.sources import (
    build_gallery_dl_scan_url,
    infer_author_username,
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
          [2, {"tweet_id": 456, "author": {"name": "bob"}}]
        ]
        """

        rows = parse_gallery_dl_records(stdout, "https://x.com/alice/media")

        self.assertEqual([row["tweet_id"] for row in rows], ["123", "456"])
        self.assertEqual(rows[0]["url"], "https://x.com/alice/status/123")
        self.assertEqual(rows[0]["text"], "hello")

    def test_build_gallery_dl_scan_url_uses_timeline_for_profile(self) -> None:
        self.assertEqual(
            build_gallery_dl_scan_url("profile", "https://x.com/earthcurated"),
            "https://x.com/earthcurated/timeline",
        )


if __name__ == "__main__":
    unittest.main()
