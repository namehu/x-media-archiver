import unittest
from datetime import UTC, date, datetime
from pathlib import Path
from types import SimpleNamespace

from xarchiver.db import connect
from xarchiver.search import (
    list_author_options,
    list_tweet_search_options,
    search_media,
    search_post_feed,
    search_tweet_library,
)
from xarchiver.services.library import get_tweet_detail, list_posts_page, search_tweets_page


class SearchIntegrationTests(unittest.TestCase):
    tweet_id = "search-fixture-1"
    extra_tweet_id = "search-fixture-2"
    duplicate_tweet_id = "search-fixture-3"
    feed_tweet_id = "search-feed-fixture-4"
    wildcard_literal_tweet_id = "search-wildcard-literal-5"
    wildcard_near_tweet_id = "search-wildcard-near-6"
    random_tweet_ids = tuple(f"search-random-fixture-{index}" for index in range(1, 7))

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
                    "insert into tags (name, color) values ('量子物理', '#3366ff') returning id"
                )
                self.tag_id = int(cur.fetchone()["id"])
                cur.execute(
                    "insert into tweet_tags (tweet_id, tag_id) values (%s, %s)",
                    (self.tweet_id, self.tag_id),
                )
                cur.execute(
                    "insert into collections (name, description) values ('研究稍后看', '测试合集') returning id"
                )
                self.collection_id = int(cur.fetchone()["id"])
                cur.execute(
                    "insert into collection_tweets (collection_id, tweet_id) values (%s, %s)",
                    (self.collection_id, self.tweet_id),
                )
                cur.execute(
                    "insert into tweet_notes (tweet_id, content) values (%s, '中文私人备注：叠加态实验')",
                    (self.tweet_id,),
                )
                cur.execute(
                    """
                    insert into tweets (
                        tweet_id, url, author_username, author_display_name, text,
                        published_at, imported_at, download_status
                    )
                    values (%s, %s, 'feed_author', 'Feed Author', 'video feed sample',
                            '2026-08-12 00:30:00+00', '2026-08-12 00:30:00+00', 'verified')
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
                for index, tweet_id in enumerate(self.random_tweet_ids, start=1):
                    marker = "keep" if index % 2 else "drop"
                    cur.execute(
                        """
                        insert into tweets (
                            tweet_id, url, author_username, author_display_name, text,
                            published_at, imported_at, download_status
                        )
                        values (%s, %s, 'random_feed_author', 'Random Feed Author', %s,
                                now() - (%s * interval '1 minute'),
                                now() - (%s * interval '1 minute'), 'verified')
                        """,
                        (
                            tweet_id,
                            f"https://x.com/random_feed_author/status/{tweet_id}",
                            f"random timeline {marker}",
                            index,
                            index,
                        ),
                    )
                    cur.execute(
                        """
                        insert into media_assets (
                            tweet_id, media_index, media_type, local_path,
                            source_engine, download_status
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
                cur.execute(
                    "delete from archive_sources where source_url in (%s, %s)",
                    (
                        "https://x.com/feed_author/likes",
                        "manual://feed-test",
                    ),
                )
                for tweet_id in (
                    self.tweet_id,
                    self.extra_tweet_id,
                    self.duplicate_tweet_id,
                    self.feed_tweet_id,
                    self.wildcard_literal_tweet_id,
                    self.wildcard_near_tweet_id,
                    *self.random_tweet_ids,
                ):
                    cur.execute("delete from tweets where tweet_id = %s", (tweet_id,))
                cur.execute(
                    "delete from tags where name in ('量子物理', '重命名标签')"
                )
                cur.execute(
                    "delete from collections where name in ('研究稍后看', '重命名合集')"
                )
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

    def test_random_post_feed_is_stable_across_pages_and_filters(self) -> None:
        def page_ids(*, seed: str, text: str | None = None, limit: int = 10, offset: int = 0) -> list[str]:
            posts, _, _ = search_post_feed(
                author_username="random_feed_author",
                text=text,
                sort="random",
                seed=seed,
                limit=limit,
                offset=offset,
            )
            return [row.tweet_id for row in posts]

        first_page = page_ids(seed="alpha", limit=3)
        repeated_first_page = page_ids(seed="alpha", limit=3)
        second_page = page_ids(seed="alpha", limit=3, offset=3)
        complete_order = first_page + second_page
        different_order = page_ids(seed="bravo")
        filtered_order = page_ids(seed="alpha", text="keep")

        self.assertEqual(first_page, repeated_first_page)
        self.assertFalse(set(first_page) & set(second_page))
        self.assertCountEqual(complete_order, self.random_tweet_ids)
        self.assertNotEqual(complete_order, different_order)
        self.assertEqual(
            filtered_order,
            [tweet_id for tweet_id in complete_order if int(tweet_id.rsplit("-", 1)[1]) % 2],
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

    def test_tweet_search_finds_text_author_tag_collection_and_note(self) -> None:
        for query in (
            "chaos",
            "search_author",
            "量子物理",
            "研究稍后看",
            "叠加态",
            "chao",
        ):
            with self.subTest(query=query):
                rows, media, organization, total_count = search_tweet_library(
                    query=query,
                    tweet_status="verified",
                    limit=10,
                )

                self.assertIn(self.tweet_id, {row.tweet_id for row in rows})
                self.assertGreaterEqual(total_count, 1)
                self.assertIn(self.tweet_id, {row.tweet_id for row in media})
                self.assertIn("量子物理", organization[self.tweet_id]["tags"])
                self.assertIn("研究稍后看", organization[self.tweet_id]["collections"])
                self.assertIn("叠加态", str(organization[self.tweet_id]["note_excerpt"]))

    def test_tweet_search_treats_like_wildcards_as_literal_characters(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                for tweet_id, text in (
                    (self.wildcard_literal_tweet_id, "sale 50%_off today"),
                    (self.wildcard_near_tweet_id, "sale 50 off today"),
                ):
                    cur.execute(
                        """
                        insert into tweets (
                            tweet_id, url, author_username, text, download_status
                        )
                        values (%s, %s, 'wildcard_fixture', %s, 'verified')
                        """,
                        (tweet_id, f"https://x.com/wildcard_fixture/status/{tweet_id}", text),
                    )
            conn.commit()

        rows, _, _, total_count = search_tweet_library(query="50%_off", limit=10)

        self.assertEqual([row.tweet_id for row in rows], [self.wildcard_literal_tweet_id])
        self.assertEqual(total_count, 1)

    def test_tweet_search_filters_tag_collection_source_and_status(self) -> None:
        page = search_tweets_page(
            settings=SimpleNamespace(archive_dir=Path("/app/archive")),
            query="叠加态",
            tag_id=self.tag_id,
            collection_id=self.collection_id,
            tweet_status="verified",
            limit=10,
        )
        no_match = search_tweets_page(
            settings=SimpleNamespace(archive_dir=Path("/app/archive")),
            query="叠加态",
            source_id=self.likes_source_id,
            tweet_status="verified",
            limit=10,
        )

        self.assertEqual(page["total_count"], 1)
        self.assertEqual(page["rows"][0]["tweet_id"], self.tweet_id)
        self.assertEqual(page["rows"][0]["tags"], ["量子物理"])
        self.assertEqual(no_match["total_count"], 0)

    def test_tweet_search_filters_browser_local_date_media_and_status(self) -> None:
        local_day = search_tweets_page(
            settings=SimpleNamespace(archive_dir=Path("/app/archive")),
            query="video feed sample",
            date_from=date(2026, 8, 12),
            date_to=date(2026, 8, 12),
            client_utc_offset_minutes=-480,
            media_type="video",
            tweet_status="verified",
            limit=10,
        )
        next_local_day = search_tweets_page(
            settings=SimpleNamespace(archive_dir=Path("/app/archive")),
            query="video feed sample",
            date_from=date(2026, 8, 13),
            date_to=date(2026, 8, 13),
            client_utc_offset_minutes=-480,
            media_type="video",
            tweet_status="verified",
            limit=10,
        )
        wrong_media, _, _, _ = search_tweet_library(
            query="video feed sample",
            media_type="audio",
            tweet_status="verified",
            limit=10,
        )
        wrong_status, _, _, _ = search_tweet_library(
            query="video feed sample",
            media_type="video",
            tweet_status="pending",
            limit=10,
        )

        self.assertEqual(local_day["total_count"], 1)
        self.assertEqual(local_day["rows"][0]["tweet_id"], self.feed_tweet_id)
        self.assertEqual(next_local_day["total_count"], 0)
        self.assertEqual(wrong_media, [])
        self.assertEqual(wrong_status, [])

    def test_tweet_search_sorts_and_paginates_with_consistent_count(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                for tweet_id, text, published_at in (
                    (
                        self.wildcard_literal_tweet_id,
                        "ordering fixture older",
                        datetime(2026, 1, 1, tzinfo=UTC),
                    ),
                    (
                        self.wildcard_near_tweet_id,
                        "ordering fixture newer",
                        datetime(2026, 2, 1, tzinfo=UTC),
                    ),
                ):
                    cur.execute(
                        """
                        insert into tweets (
                            tweet_id, url, author_username, text, published_at, download_status
                        )
                        values (%s, %s, 'ordering_fixture', %s, %s, 'verified')
                        """,
                        (
                            tweet_id,
                            f"https://x.com/ordering_fixture/status/{tweet_id}",
                            text,
                            published_at,
                        ),
                    )
            conn.commit()

        newest, _, _, newest_count = search_tweet_library(
            query="ordering fixture",
            sort="newest",
            limit=1,
            offset=0,
        )
        second, _, _, second_count = search_tweet_library(
            query="ordering fixture",
            sort="newest",
            limit=1,
            offset=1,
        )
        oldest, _, _, oldest_count = search_tweet_library(
            query="ordering fixture",
            sort="oldest",
            limit=1,
            offset=0,
        )

        self.assertEqual([row.tweet_id for row in newest], [self.wildcard_near_tweet_id])
        self.assertEqual([row.tweet_id for row in second], [self.wildcard_literal_tweet_id])
        self.assertEqual([row.tweet_id for row in oldest], [self.wildcard_literal_tweet_id])
        self.assertEqual((newest_count, second_count, oldest_count), (2, 2, 2))

    def test_tweet_search_document_refreshes_after_organization_updates(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("update tags set name = '重命名标签' where id = %s", (self.tag_id,))
                cur.execute(
                    "update collections set name = '重命名合集' where id = %s",
                    (self.collection_id,),
                )
                cur.execute(
                    "update tweet_notes set content = '更新后的备注关键词' where tweet_id = %s",
                    (self.tweet_id,),
                )
            conn.commit()

        for query in ("重命名标签", "重命名合集", "更新后的备注"):
            rows, _, _, _ = search_tweet_library(query=query, limit=10)
            self.assertIn(self.tweet_id, {row.tweet_id for row in rows})

    def test_tweet_search_document_refreshes_after_organization_links_are_removed(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "delete from tweet_tags where tweet_id = %s and tag_id = %s",
                    (self.tweet_id, self.tag_id),
                )
                cur.execute(
                    "delete from collection_tweets where tweet_id = %s and collection_id = %s",
                    (self.tweet_id, self.collection_id),
                )
                cur.execute("delete from tweet_notes where tweet_id = %s", (self.tweet_id,))
            conn.commit()

        for query in ("量子物理", "研究稍后看", "叠加态"):
            rows, _, _, _ = search_tweet_library(query=query, limit=10)
            self.assertNotIn(self.tweet_id, {row.tweet_id for row in rows})

    def test_tweet_search_options_return_counts(self) -> None:
        tag_rows, collection_rows = list_tweet_search_options()

        tag = next(row for row in tag_rows if row.id == self.tag_id)
        collection = next(row for row in collection_rows if row.id == self.collection_id)
        self.assertEqual(tag.tweet_count, 1)
        self.assertEqual(collection.tweet_count, 1)


if __name__ == "__main__":
    unittest.main()
