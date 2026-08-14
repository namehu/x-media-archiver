import unittest
from datetime import UTC, datetime

from pydantic import ValidationError

from xarchiver.row_models import SearchMediaRow
from xarchiver.search import (
    build_author_options_query,
    build_post_feed_count_query,
    build_post_feed_media_query,
    build_post_feed_query,
    build_search_query,
    build_tweet_library_search_count_query,
    build_tweet_library_search_query,
    compact_text,
)


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

        normalized_sql = sql.lower()

        self.assertIn("author_username ilike", normalized_sql)
        self.assertIn("tweets.text ilike", normalized_sql)
        self.assertIn("tweets.download_status = %(tweet_status)s", sql)
        self.assertIn("media_assets.download_status = %(media_status)s", sql)
        self.assertIn("media_assets.media_type = %(media_type)s", sql)
        self.assertEqual(
            params,
            {
                "author_pattern": "%physics%",
                "text_pattern": "%chaos%",
                "tweet_status": "verified",
                "media_status": "verified",
                "media_type": "video",
                "limit": 10,
                "offset": 0,
            },
        )

    def test_build_search_query_skips_media_status_for_all(self) -> None:
        sql, params = build_search_query(None, None, None, "all", None, 5)

        self.assertNotIn("media_assets.download_status = %(media_status)s", sql)
        self.assertEqual(params, {"limit": 5, "offset": 0})

    def test_build_search_query_supports_exact_author_username(self) -> None:
        sql, params = build_search_query(
            None,
            None,
            None,
            "verified",
            None,
            10,
            author_username="Alice",
        )

        self.assertIn("lower(tweets.author_username) = %(author_username)s", sql)
        self.assertEqual(params["author_username"], "alice")
        self.assertNotIn("author_pattern", params)

    def test_build_author_options_query_groups_and_normalizes_at_prefix(self) -> None:
        sql, params = build_author_options_query("  @physics  ", 15)
        normalized_sql = sql.lower()

        self.assertIn("group by lower(tweets.author_username)", normalized_sql)
        self.assertIn("count(media_assets.id)", normalized_sql)
        self.assertIn("tweets.author_display_name ilike", normalized_sql)
        self.assertEqual(
            params,
            {"author_query_pattern": "%physics%", "limit": 15},
        )

    def test_build_post_feed_query_filters_at_tweet_level(self) -> None:
        sql, params = build_post_feed_query(
            source_id=7,
            source_type="likes",
            author_username="@Alice",
            text="chaos",
            media_type="video",
            limit=20,
            offset=40,
        )
        normalized_sql = sql.lower()

        self.assertIn("exists", normalized_sql)
        self.assertIn("source_discovered_tweets", normalized_sql)
        self.assertIn("archive_sources", normalized_sql)
        self.assertIn("order by tweets.published_at desc nulls last", normalized_sql)
        self.assertEqual(params["post_source_id"], 7)
        self.assertEqual(params["post_source_type"], "likes")
        self.assertEqual(params["post_author_username"], "alice")
        self.assertEqual(params["post_text_pattern"], "%chaos%")
        self.assertEqual(params["post_media_type"], "video")
        self.assertEqual(params["limit"], 20)
        self.assertEqual(params["offset"], 40)

    def test_post_feed_count_and_media_queries_use_verified_media(self) -> None:
        count_sql, count_params = build_post_feed_count_query()
        media_sql, media_params = build_post_feed_media_query(["one", "two"])

        self.assertNotIn(" limit ", count_sql.lower())
        self.assertEqual(count_params["post_media_status"], "verified")
        self.assertIn("media_assets.tweet_id in", media_sql.lower())
        self.assertEqual(media_params["feed_media_status"], "verified")
        self.assertIn("one", media_params.values())
        self.assertIn("two", media_params.values())

    def test_compact_text_normalizes_whitespace_and_truncates(self) -> None:
        self.assertEqual(compact_text("a\n\nb\tc", 20), "a b c")
        self.assertEqual(compact_text("1234567890", 5), "1234...")

    def test_search_media_row_supports_dict_style_access(self) -> None:
        row = SearchMediaRow.model_validate(
            {
                "id": 1,
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
            SearchMediaRow.model_validate({"id": 1, "tweet_id": "1"})

    def test_tweet_search_combines_full_text_trigram_and_structured_filters(self) -> None:
        date_from = datetime(2026, 1, 1, tzinfo=UTC)
        date_to = datetime(2026, 2, 1, tzinfo=UTC)
        sql, params = build_tweet_library_search_query(
            query="量子 chaos",
            source_id=4,
            date_from=date_from,
            date_to=date_to,
            media_type="video",
            tweet_status="missing",
            tag_id=6,
            collection_id=8,
            sort="relevance",
            limit=25,
            offset=50,
        )
        normalized_sql = sql.lower()

        self.assertIn("websearch_to_tsquery", normalized_sql)
        self.assertIn("tweet_search_documents.search_vector @@", normalized_sql)
        self.assertIn("word_similarity", normalized_sql)
        self.assertIn("source_discovered_tweets", normalized_sql)
        self.assertIn("tweet_tags", normalized_sql)
        self.assertIn("collection_tweets", normalized_sql)
        self.assertIn("order by", normalized_sql)
        self.assertIn("relevance desc", normalized_sql)
        self.assertEqual(params["search_query"], "量子 chaos")
        self.assertEqual(params["search_source_id"], 4)
        self.assertEqual(params["search_media_type"], "video")
        self.assertEqual(params["search_tweet_status"], "missing")
        self.assertEqual(params["search_tag_id"], 6)
        self.assertEqual(params["search_collection_id"], 8)
        self.assertEqual(params["limit"], 25)
        self.assertEqual(params["offset"], 50)

    def test_tweet_search_without_query_defaults_to_newest_and_all_status_skips_filter(self) -> None:
        sql, params = build_tweet_library_search_query(
            query=None,
            tweet_status="all",
            sort="auto",
            limit=20,
        )

        self.assertNotIn("websearch_to_tsquery", sql.lower())
        self.assertNotIn("search_tweet_status", params)
        self.assertIn("tweets.published_at desc nulls last", sql.lower())

    def test_tweet_search_count_has_no_sort_or_pagination(self) -> None:
        sql, params = build_tweet_library_search_count_query(query="physics")

        self.assertNotIn(" order by ", sql.lower())
        self.assertNotIn(" limit ", sql.lower())
        self.assertNotIn("limit", params)
        self.assertEqual(params["search_query"], "physics")

    def test_tweet_search_uses_literal_substring_matching_for_wildcards(self) -> None:
        sql, params = build_tweet_library_search_query(query="50%_off", limit=10)

        self.assertIn(" like ", sql.lower())
        self.assertIn("escape '!'", sql.lower())
        self.assertNotIn("websearch_to_tsquery", sql.lower())
        self.assertNotIn("word_similarity", sql.lower())
        self.assertNotIn("search_query", params)
        self.assertEqual(params["search_substring_pattern"], "%50!%!_off%")

    def test_tweet_search_uses_exact_normalized_platform_hashtag_filter(self) -> None:
        sql, params = build_tweet_library_search_query(
            hashtag="#ＡＩ",
            tweet_status="all",
            limit=10,
        )
        normalized_sql = " ".join(sql.lower().split())

        self.assertIn("tweet_hashtags", normalized_sql)
        self.assertIn("hashtags", normalized_sql)
        self.assertEqual(params["search_hashtag"], "ai")
        self.assertNotIn("search_tweet_status", params)

    def test_blank_platform_hashtag_filter_matches_nothing(self) -> None:
        sql, params = build_tweet_library_search_query(
            hashtag="#",
            tweet_status="all",
            limit=10,
        )

        self.assertIn("false", sql.lower())
        self.assertNotIn("search_hashtag", params)


if __name__ == "__main__":
    unittest.main()
