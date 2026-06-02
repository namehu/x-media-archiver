import unittest
from datetime import UTC, datetime

from pydantic import ValidationError

from xarchiver.search import build_search_query, compact_text
from xarchiver.row_models import SearchMediaRow


class SearchUnitTests(unittest.TestCase):
    def test_build_search_query_adds_filters_and_limit(self) -> None:
        sql, params = build_search_query(
            author="physics",
            text="chaos",
            tweet_status="verified",
            media_status="verified",
            media_type="video",
            limit=10,
        )

        self.assertIn("author_username ilike", sql)
        self.assertIn("t.text ilike", sql)
        self.assertIn("t.download_status = %s", sql)
        self.assertIn("m.download_status = %s", sql)
        self.assertIn("m.media_type = %s", sql)
        self.assertEqual(params, ("%physics%", "%physics%", "%chaos%", "verified", "verified", "video", 10, 0))

    def test_build_search_query_skips_media_status_for_all(self) -> None:
        sql, params = build_search_query(None, None, None, "all", None, 5)

        self.assertNotIn("m.download_status = %s", sql)
        self.assertEqual(params, (5, 0))

    def test_compact_text_normalizes_whitespace_and_truncates(self) -> None:
        self.assertEqual(compact_text("a\n\nb\tc", 20), "a b c")
        self.assertEqual(compact_text("1234567890", 5), "1234...")

    def test_search_media_row_supports_dict_style_access(self) -> None:
        row = SearchMediaRow.model_validate(
            {
                "tweet_id": "1",
                "tweet_url": "https://x.com/a/status/1",
                "published_at": datetime(2026, 1, 1, tzinfo=UTC),
                "tweet_text": "hello",
                "tweet_status": "verified",
                "media_status": "verified",
            }
        )

        self.assertEqual(row.tweet_id, "1")
        self.assertEqual(row["tweet_id"], "1")
        self.assertEqual(row.get("missing", "fallback"), "fallback")
        self.assertEqual(dict(row)["media_status"], "verified")

    def test_search_media_row_rejects_missing_required_fields(self) -> None:
        with self.assertRaises(ValidationError):
            SearchMediaRow.model_validate({"tweet_id": "1"})


if __name__ == "__main__":
    unittest.main()
