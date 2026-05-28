import unittest

from xarchiver.db import connect
from xarchiver.search import search_media


class SearchIntegrationTests(unittest.TestCase):
    tweet_id = "search-fixture-1"

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
            conn.commit()

    def tearDown(self) -> None:
        self.cleanup_db()

    def cleanup_db(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("delete from tweets where tweet_id = %s", (self.tweet_id,))
            conn.commit()

    def test_search_media_filters_author_text_and_type(self) -> None:
        rows = search_media(author="search", text="chaos", media_status="verified", media_type="photo", limit=10)
        tweet_ids = {row["tweet_id"] for row in rows}

        self.assertIn(self.tweet_id, tweet_ids)

    def test_search_media_supports_offset(self) -> None:
        rows = search_media(author="search", media_status="verified", limit=10, offset=1)

        self.assertNotIn(self.tweet_id, {row["tweet_id"] for row in rows})


if __name__ == "__main__":
    unittest.main()
