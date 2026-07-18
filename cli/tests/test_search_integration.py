import unittest
from pathlib import Path
from types import SimpleNamespace

from xarchiver.db import connect
from xarchiver.search import list_author_options, search_media, search_post_feed
from xarchiver.services.library import get_tweet_detail, list_posts_page


class SearchIntegrationTests(unittest.TestCase):
    tweet_id = "search-fixture-1"
    extra_tweet_id = "search-fixture-2"
    duplicate_tweet_id = "search-fixture-3"
    feed_tweet_id = "search-feed-fixture-4"

    def setUp(self) -> None:
        self.cleanup_db()
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into tweets (
                        tweet_id,
                        url,
                        author_username,
                        author_display_name,
                        text,
                        download_status
                    )
                    values (%s, %s, 'search_author', 'Search Author', 'A searchable chaos sample', 'verified')
                    """,
                    (self.tweet_id, f"https://x.com/search_author/status/{self.tweet_id}"),
                )
                cur.execute(
                    """
                    insert into media_assets (
                        tweet_id,
                        media_index,
                        media_type,
                        local_path,
                        source_engine,
                        download_status
                    )
                    values (%s, 1, 'photo', '/tmp/search-fixture.jpg', 'test', 'verified')
                    """,
                    (self.tweet_id,),
                )
                cur.execute(
                    """
                    insert into tweets (
                        tweet_id, url, author_username, author_display_name, text,
                        published_at, imported_at, download_status
                    )
                    values (%s, %s, 'feed_author', 'Feed Author', 'video feed sample',
                            now(), now(), 'verified')
                    """,
                    (self.feed_tweet_id, f"https://x.com/feed_author/status/{self.feed_tweet_id}"),
                )
                for media_index, media_type, status in (
                    (1, "photo", "verified"),
                    (2, "video", "verified"),
                    (3, "photo", "corrupt"),
                ):
                    cur.execute(
                        """
                        insert into media_assets (
                            tweet_id, media_index, media_type, local_path, source_engine, download_status
                        )
                        values (%s, %s, %s, %s, 'test', %s)
                        """,
                        (
                            self.feed_tweet_id,
                            media_index,
                            media_type,
                            f"/app/archive/media/feed/{self.feed_tweet_id}-{media_index}.bin",
                            status,
                        ),
                    )
                cur.execute(
                    """
                    insert into archive_sources (source_type, source_url, label, author_username)
                    values ('likes', 'https://x.com/feed_author/likes', '我的喜欢', 'feed_author')
                    returning id
                    """
                )
                self.likes_source_id = int(cur.fetchone()["id"])
                cur.execute(
                    """
                    insert into archive_sources (source_type, source_url, label)
                    values ('manual', 'manual://feed-test', 'Feed manual')
                    returning id
                    """
                )
                self.manual_source_id = int(cur.fetchone()["id"])
                for source_id in (self.likes_source_id, self.manual_source_id):
                    cur.execute(
                        """
                        insert into source_discovered_tweets (source_id, tweet_id, discovered_at, raw_payload)
                        values (%s, %s, now(), '{}'::jsonb)
                        """,
                        (source_id, self.feed_tweet_id),
                    )
                for tweet_id, username, display_name in (
                    (self.extra_tweet_id, "search_author_extra", "Search Author Extra"),
                    (self.duplicate_tweet_id, "search_author", "Search Author"),
                ):
                    cur.execute(
                        """
                        insert into tweets (
                            tweet_id, url, author_username, author_display_name, text, download_status
                        )
                        values (%s, %s, %s, %s, 'author option fixture', 'verified')
                        """,
                        (tweet_id, f"https://x.com/{username}/status/{tweet_id}", username, display_name),
                    )
                    cur.execute(
                        """
                        insert into media_assets (
                            tweet_id, media_index, media_type, local_path, source_engine, download_status
                        )
                        values (%s, 1, 'photo', %s, 'test', 'verified')
                        """,
                        (tweet_id, f"/tmp/{tweet_id}.jpg"),
                    )
                cur.execute(
                    """
                    insert into download_attempts (
                        tweet_id,
                        engine,
                        status,
                        exit_code,
                        error_category,
                        error_message,
                        finished_at
                    )
                    values (%s, 'test', 'succeeded', 0, null, null, now())
                    """,
                    (self.tweet_id,),
                )
            conn.commit()

    def tearDown(self) -> None:
        self.cleanup_db()

    def cleanup_db(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("delete from archive_sources where source_url in (%s, %s)", (
                    "https://x.com/feed_author/likes",
                    "manual://feed-test",
                ))
                for tweet_id in (
                    self.tweet_id,
                    self.extra_tweet_id,
                    self.duplicate_tweet_id,
                    self.feed_tweet_id,
                ):
                    cur.execute("delete from tweets where tweet_id = %s", (tweet_id,))
            conn.commit()

    def test_search_media_filters_author_text_and_type(self) -> None:
        rows = search_media(author="search", text="chaos", media_status="verified", media_type="photo", limit=10)
        tweet_ids = {row["tweet_id"] for row in rows}

        self.assertIn(self.tweet_id, tweet_ids)

    def test_search_media_supports_offset(self) -> None:
        rows = search_media(author="search", media_status="verified", limit=10, offset=1)

        self.assertNotIn(self.tweet_id, {row["tweet_id"] for row in rows})

    def test_search_media_filters_exact_author_username(self) -> None:
        rows = search_media(author_username="search_author", media_status="verified", limit=10)
        tweet_ids = {row["tweet_id"] for row in rows}

        self.assertIn(self.tweet_id, tweet_ids)
        self.assertIn(self.duplicate_tweet_id, tweet_ids)
        self.assertNotIn(self.extra_tweet_id, tweet_ids)

    def test_list_author_options_searches_display_name_and_groups_username(self) -> None:
        rows = list_author_options(query="@search_author", limit=10)
        options = {row.author_username: row for row in rows}
        display_name_rows = list_author_options(query="Author Extra", limit=10)

        self.assertEqual(options["search_author"].media_count, 2)
        self.assertEqual(options["search_author"].author_display_name, "Search Author")
        self.assertIn("search_author_extra", options)
        self.assertEqual(
            [row.author_username for row in display_name_rows],
            ["search_author_extra"],
        )

    def test_post_feed_groups_media_and_filters_source_without_duplicates(self) -> None:
        posts, media, total_count = search_post_feed(
            source_type="likes",
            author_username="@feed_author",
            text="video feed",
            media_type="video",
            limit=10,
        )

        self.assertEqual([row.tweet_id for row in posts], [self.feed_tweet_id])
        self.assertEqual(total_count, 1)
        self.assertEqual([row.media_index for row in media], [1, 2])
        self.assertNotIn("corrupt", {row.media_status for row in media})

    def test_posts_page_returns_all_verified_media_for_matching_type(self) -> None:
        page = list_posts_page(
            settings=SimpleNamespace(archive_dir=Path("/app/archive")),
            source_id=self.manual_source_id,
            media_type="video",
            limit=10,
        )

        self.assertEqual(page["total_count"], 1)
        self.assertEqual(page["rows"][0]["tweet_id"], self.feed_tweet_id)
        self.assertEqual(
            [row["media_type"] for row in page["rows"][0]["media"]],
            ["photo", "video"],
        )

    def test_get_tweet_detail_maps_rows_to_response_dicts(self) -> None:
        detail = get_tweet_detail(
            settings=SimpleNamespace(archive_dir=Path("/app/archive")),
            tweet_id=self.tweet_id,
        )

        self.assertIsNotNone(detail)
        assert detail is not None
        self.assertEqual(detail["tweet"]["tweet_id"], self.tweet_id)
        self.assertEqual(detail["media"][0]["media_status"], "verified")
        self.assertEqual(detail["attempts"][0]["status"], "succeeded")


if __name__ == "__main__":
    unittest.main()
