import unittest

from xarchiver.search import build_search_query, compact_text


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
        self.assertEqual(params, ("%physics%", "%physics%", "%chaos%", "verified", "verified", "video", 10))

    def test_build_search_query_skips_media_status_for_all(self) -> None:
        sql, params = build_search_query(None, None, None, "all", None, 5)

        self.assertNotIn("m.download_status = %s", sql)
        self.assertEqual(params, (5,))

    def test_compact_text_normalizes_whitespace_and_truncates(self) -> None:
        self.assertEqual(compact_text("a\n\nb\tc", 20), "a b c")
        self.assertEqual(compact_text("1234567890", 5), "1234...")


if __name__ == "__main__":
    unittest.main()
