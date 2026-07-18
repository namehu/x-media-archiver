import unittest
from pathlib import Path
from types import SimpleNamespace

from xarchiver.db import connect
from xarchiver.search import list_author_options, search_media
from xarchiver.services.library import get_tweet_detail


class SearchIntegrationTests(unittest.TestCase):
    tweet_id = "search-fixture-1"
    extra_tweet_id = "search-fixture-2"
    duplicate_tweet_id = "search-fixture-3"

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
                for tweet_id in (self.tweet_id, self.extra_tweet_id, self.duplicate_tweet_id):
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
