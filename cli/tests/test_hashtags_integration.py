import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import orjson

from xarchiver.api.schemas import PostFeedPageResponse, TweetDetailResponse, TweetSearchPageResponse
from xarchiver.db import connect
from xarchiver.search import search_tweet_library
from xarchiver.services.hashtags import (
    list_hashtag_options,
    run_hashtag_backfill,
    sync_registered_gallery_hashtags,
)
from xarchiver.services.library import get_tweet_detail, list_posts_page, search_tweets_page


class PlatformHashtagIntegrationTests(unittest.TestCase):
    tweet_id = "923000000000000001"

    def setUp(self) -> None:
        self.run_ids: list[int] = []
        self.cleanup_db()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.archive_dir = Path(self.temp_dir.name) / "archive"
        tweet_dir = self.archive_dir / "media" / "m5-author" / self.tweet_id
        tweet_dir.mkdir(parents=True)
        self.first_media = tweet_dir / "first.jpg"
        self.second_media = tweet_dir / "second.jpg"
        self.first_metadata = tweet_dir / "first.jpg.json"
        self.second_metadata = tweet_dir / "second.jpg.json"
        self.unregistered_metadata = tweet_dir / "unregistered.jpg.json"
        self.first_media.write_bytes(b"first-image")
        self.second_media.write_bytes(b"second-image")
        self.write_metadata(self.first_metadata, ["M5-AI", "M5-Science"], media_index=1)
        self.write_metadata(self.second_metadata, ["m5-ai", "M5-Extra"], media_index=2)
        self.write_metadata(
            self.unregistered_metadata,
            ["M5-Unregistered"],
            media_index=3,
        )

        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into tweets (
                      tweet_id, url, author_username, text, download_status
                    )
                    values (%s, %s, 'm5_author', 'platform hashtag fixture', 'verified')
                    """,
                    (self.tweet_id, f"https://x.com/m5_author/status/{self.tweet_id}"),
                )
                for media_index, media_path, metadata_path in (
                    (1, self.first_media, self.first_metadata),
                    (2, self.second_media, self.second_metadata),
                ):
                    cur.execute(
                        """
                        insert into media_assets (
                          tweet_id, media_index, media_type, local_path, metadata_path,
                          source_engine, download_status
                        )
                        values (%s, %s, 'photo', %s, %s, 'gallery-dl', 'verified')
                        """,
                        (
                            self.tweet_id,
                            media_index,
                            media_path.as_posix(),
                            metadata_path.as_posix(),
                        ),
                    )
            conn.commit()

    def tearDown(self) -> None:
        self.cleanup_db()
        self.temp_dir.cleanup()

    def cleanup_db(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                if getattr(self, "run_ids", None):
                    cur.execute(
                        "select log_stream_id from hashtag_backfill_runs where id = any(%s)",
                        (self.run_ids,),
                    )
                    log_stream_ids = [int(row["log_stream_id"]) for row in cur.fetchall() if row["log_stream_id"]]
                    cur.execute("delete from hashtag_backfill_runs where id = any(%s)", (self.run_ids,))
                    if log_stream_ids:
                        cur.execute(
                            "delete from operation_log_streams where id = any(%s)",
                            (log_stream_ids,),
                        )
                cur.execute("delete from tweets where tweet_id = %s", (self.tweet_id,))
                cur.execute("delete from hashtags where normalized_name like 'm5-%'")
            conn.commit()

    def write_metadata(self, path: Path, hashtags: list[str], *, media_index: int) -> None:
        path.write_bytes(
            orjson.dumps(
                {
                    "tweet_id": self.tweet_id,
                    "content": "platform hashtag fixture",
                    "hashtags": hashtags,
                    "type": "photo",
                    "num": media_index,
                }
            )
        )

    def test_additive_sync_search_and_read_models_preserve_first_observation(self) -> None:
        first = sync_registered_gallery_hashtags(
            self.archive_dir,
            tweet_ids=[self.tweet_id],
            gallery_dl_version="1.32.1",
        )

        self.assertEqual(first["candidate_relationship_count"], 3)
        self.assertEqual(first["inserted_relationship_count"], 3)
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select h.normalized_name, th.display_name, th.position, th.gallery_dl_version
                    from tweet_hashtags th
                    join hashtags h on h.id = th.hashtag_id
                    where th.tweet_id = %s
                    order by th.position, h.normalized_name
                    """,
                    (self.tweet_id,),
                )
                observed = [dict(row) for row in cur.fetchall()]
        self.assertEqual(
            [(row["normalized_name"], row["display_name"]) for row in observed],
            [("m5-ai", "M5-AI"), ("m5-extra", "M5-Extra"), ("m5-science", "M5-Science")],
        )
        self.assertTrue(all(row["gallery_dl_version"] == "1.32.1" for row in observed))

        exact_rows, _, _, exact_count = search_tweet_library(
            hashtag="#M5-AI",
            tweet_status="all",
        )
        text_rows, _, _, text_count = search_tweet_library(
            query="M5-Science",
            tweet_status="all",
        )
        _, _, _, combined_no_match_count = search_tweet_library(
            media_type="video",
            hashtag="m5-ai",
            tweet_status="all",
        )
        feed = list_posts_page(
            SimpleNamespace(archive_dir=self.archive_dir),
            author_username="m5_author",
        )
        search_page = search_tweets_page(
            SimpleNamespace(archive_dir=self.archive_dir),
            hashtag="m5-ai",
            tweet_status="all",
        )
        detail = get_tweet_detail(SimpleNamespace(archive_dir=self.archive_dir), self.tweet_id)
        options = list_hashtag_options(query="m5-", limit=10)

        self.assertEqual(exact_count, 1)
        self.assertEqual(exact_rows[0].tweet_id, self.tweet_id)
        self.assertEqual(text_count, 1)
        self.assertEqual(text_rows[0].tweet_id, self.tweet_id)
        self.assertEqual(combined_no_match_count, 0)
        PostFeedPageResponse.model_validate(feed)
        TweetSearchPageResponse.model_validate(search_page)
        assert detail is not None
        TweetDetailResponse.model_validate(detail)
        self.assertEqual(feed["rows"][0]["hashtags"][0], "M5-AI")
        self.assertEqual(search_page["rows"][0]["hashtags"][0], "M5-AI")
        self.assertEqual(detail["hashtags"][0], "M5-AI")
        self.assertEqual({row.normalized_name for row in options}, {"m5-ai", "m5-extra", "m5-science"})
        self.assertTrue(all(row.tweet_count == 1 for row in options))

        self.write_metadata(self.first_metadata, ["M5-New"], media_index=1)
        second = sync_registered_gallery_hashtags(
            self.archive_dir,
            tweet_ids=[self.tweet_id],
            gallery_dl_version="99.0.0",
        )
        self.assertEqual(second["inserted_relationship_count"], 1)
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select h.normalized_name
                    from tweet_hashtags th
                    join hashtags h on h.id = th.hashtag_id
                    where th.tweet_id = %s
                    order by h.normalized_name
                    """,
                    (self.tweet_id,),
                )
                names = [str(row["normalized_name"]) for row in cur.fetchall()]
                cur.execute("delete from media_assets where tweet_id = %s", (self.tweet_id,))
            conn.commit()
        self.assertEqual(names, ["m5-ai", "m5-extra", "m5-new", "m5-science"])
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("select count(*) as count from tweet_hashtags where tweet_id = %s", (self.tweet_id,))
                self.assertEqual(int(cur.fetchone()["count"]), 4)

    def test_backfill_defaults_to_dry_run_and_apply_is_idempotent(self) -> None:
        settings = SimpleNamespace(
            archive_dir=self.archive_dir,
            operation_log_max_bytes=1024 * 1024,
        )
        compatibility = {
            "installed_version": "1.32.1",
            "tested_versions": ["1.32.1"],
            "validation_status": "tested",
            "warning_code": None,
        }
        with (
            patch("xarchiver.services.hashtags.gallery_dl_compatibility", return_value=compatibility),
            patch("xarchiver.services.operation_logs.get_settings", return_value=settings),
        ):
            dry_run = run_hashtag_backfill(settings)
            self.run_ids.append(int(dry_run["run_id"]))
            applied = run_hashtag_backfill(settings, apply=True, confirm_apply=True)
            self.run_ids.append(int(applied["run_id"]))
            repeated = run_hashtag_backfill(settings, apply=True, confirm_apply=True)
            self.run_ids.append(int(repeated["run_id"]))

        self.assertEqual(dry_run["mode"], "dry_run")
        self.assertEqual(dry_run["would_insert_relationship_count"], 3)
        self.assertEqual(dry_run["inserted_relationship_count"], 0)
        self.assertEqual(applied["inserted_relationship_count"], 3)
        self.assertEqual(repeated["inserted_relationship_count"], 0)
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "select status, result, finished_at from hashtag_backfill_runs where id = any(%s)",
                    (self.run_ids,),
                )
                runs = cur.fetchall()
                cur.execute(
                    "select closed_at from operation_log_streams where scope_type = 'hashtag_backfill' and scope_id = any(%s)",
                    (self.run_ids,),
                )
                streams = cur.fetchall()
        self.assertTrue(all(row["status"] == "completed" and row["result"] for row in runs))
        self.assertTrue(all(row["finished_at"] is not None for row in runs))
        self.assertTrue(all(row["closed_at"] is not None for row in streams))

    def test_interrupted_backfill_is_failed_redacted_and_closes_log(self) -> None:
        settings = SimpleNamespace(
            archive_dir=self.archive_dir,
            operation_log_max_bytes=1024 * 1024,
        )
        with (
            patch("xarchiver.services.operation_logs.get_settings", return_value=settings),
            patch(
                "xarchiver.services.hashtags._scan_registered_gallery_metadata",
                side_effect=KeyboardInterrupt("auth_token=very-secret"),
            ),
        ):
            with self.assertRaises(KeyboardInterrupt):
                run_hashtag_backfill(settings)

        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select id, status, error_message, log_stream_id
                    from hashtag_backfill_runs
                    order by id desc
                    limit 1
                    """
                )
                run = cur.fetchone()
                self.run_ids.append(int(run["id"]))
                cur.execute(
                    "select closed_at, last_message from operation_log_streams where id = %s",
                    (run["log_stream_id"],),
                )
                stream = cur.fetchone()

        self.assertEqual(run["status"], "failed")
        self.assertNotIn("very-secret", str(run["error_message"]))
        self.assertIsNotNone(stream["closed_at"])
        self.assertNotIn("very-secret", str(stream["last_message"]))


if __name__ == "__main__":
    unittest.main()
