import unittest
from unittest.mock import patch

from psycopg.errors import ReadOnlySqlTransaction

from xarchiver.api.schemas import LibraryInsightsResponse
from xarchiver.db import connect
from xarchiver.services.library import get_library_insights


class InsightsIntegrationTests(unittest.TestCase):
    tweet_ids = ["insights-fixture-1", "insights-fixture-2", "insights-fixture-3"]
    source_urls = [
        "https://x.com/insights_fixture/media",
        "https://x.com/insights_fixture/likes",
    ]

    def setUp(self) -> None:
        self.cleanup_db()
        self.baseline = LibraryInsightsResponse.model_validate(get_library_insights())
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into archive_sources (source_type, source_url, label, status)
                    values
                      ('user_media', %s, 'Insights media', 'active'),
                      ('likes', %s, 'Insights likes', 'active')
                    returning id
                    """,
                    tuple(self.source_urls),
                )
                source_ids = [int(row["id"]) for row in cur.fetchall()]
                cur.execute(
                    """
                    insert into tweets (
                      tweet_id, url, author_username, published_at, text,
                      imported_at, download_status
                    )
                    values
                      (%s, %s, 'insights_alpha', '2026-01-15 00:00:00+00',
                       'alpha text', '2026-03-01 00:00:00+00', 'verified'),
                      (%s, %s, 'insights_alpha', '2026-01-20 00:00:00+00',
                       null, '2026-03-02 00:00:00+00', 'verified'),
                      (%s, %s, null, '2026-02-01 00:00:00+00',
                       'gamma text', '2026-04-01 00:00:00+00', 'missing')
                    """,
                    (
                        self.tweet_ids[0],
                        f"https://x.com/insights_alpha/status/{self.tweet_ids[0]}",
                        self.tweet_ids[1],
                        f"https://x.com/insights_alpha/status/{self.tweet_ids[1]}",
                        self.tweet_ids[2],
                        f"https://x.com/unknown/status/{self.tweet_ids[2]}",
                    ),
                )
                cur.execute(
                    """
                    insert into media_assets (
                      tweet_id, media_index, media_type, local_path, file_size, sha256,
                      width, height, duration_ms, source_engine, download_status
                    )
                    values
                      (%s, 0, 'photo', '/app/archive/media/insights/1.jpg', 100, 'hash-1',
                       1200, 800, null, 'test', 'verified'),
                      (%s, 0, 'video', '/app/archive/media/insights/2.mp4', 400, null,
                       1920, 1080, 60000, 'test', 'verified'),
                      (%s, 0, 'photo', '/app/archive/media/insights/3.jpg', null, null,
                       null, null, null, 'test', 'missing')
                    """,
                    tuple(self.tweet_ids),
                )
                cur.execute(
                    """
                    insert into tags (name, color)
                    values ('Insights-Fixture-Tag', '#3366ff')
                    returning id
                    """
                )
                tag_id = int(cur.fetchone()["id"])
                cur.execute(
                    """
                    insert into collections (name)
                    values ('Insights-Fixture-Collection')
                    returning id
                    """
                )
                collection_id = int(cur.fetchone()["id"])
                cur.execute(
                    "insert into tweet_tags (tweet_id, tag_id) values (%s, %s)",
                    (self.tweet_ids[0], tag_id),
                )
                cur.execute(
                    "insert into collection_tweets (collection_id, tweet_id) values (%s, %s)",
                    (collection_id, self.tweet_ids[1]),
                )
                cur.execute(
                    "insert into tweet_notes (tweet_id, content) values (%s, 'fixture note')",
                    (self.tweet_ids[0],),
                )
                cur.execute(
                    """
                    insert into source_discovered_tweets (
                      source_id, tweet_id, archive_run_id, raw_payload
                    )
                    values
                      (%s, %s, null, '{}'::jsonb),
                      (%s, %s, null, '{}'::jsonb),
                      (%s, %s, null, '{}'::jsonb)
                    """,
                    (
                        source_ids[0],
                        self.tweet_ids[0],
                        source_ids[1],
                        self.tweet_ids[0],
                        source_ids[0],
                        self.tweet_ids[1],
                    ),
                )
            conn.commit()

    def tearDown(self) -> None:
        self.cleanup_db()

    def cleanup_db(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("delete from tweets where tweet_id = any(%s)", (self.tweet_ids,))
                cur.execute("delete from archive_sources where source_url = any(%s)", (self.source_urls,))
                cur.execute("delete from tags where name = 'Insights-Fixture-Tag'")
                cur.execute("delete from collections where name = 'Insights-Fixture-Collection'")
            conn.commit()

    def test_insights_use_fact_backed_counts_and_distinct_discovery_tweets(self) -> None:
        result = LibraryInsightsResponse.model_validate(get_library_insights())

        self.assertEqual(result.overview.tweet_count - self.baseline.overview.tweet_count, 3)
        self.assertEqual(result.overview.media_count - self.baseline.overview.media_count, 3)
        self.assertEqual(
            result.overview.known_media_bytes - self.baseline.overview.known_media_bytes,
            500,
        )
        self.assertEqual(
            result.overview.known_video_duration_ms
            - self.baseline.overview.known_video_duration_ms,
            60000,
        )
        self.assertEqual(result.overview.author_count - self.baseline.overview.author_count, 1)
        self.assertEqual(result.overview.source_count - self.baseline.overview.source_count, 2)

        media_types = {row.key: row for row in result.media_types}
        baseline_media_type_counts = {row.key: row.count for row in self.baseline.media_types}
        self.assertEqual(
            media_types["photo"].count - baseline_media_type_counts.get("photo", 0),
            2,
        )
        self.assertEqual(
            media_types["video"].count - baseline_media_type_counts.get("video", 0),
            1,
        )

        author = next(row for row in result.top_authors if row.author_username == "insights_alpha")
        self.assertEqual(author.tweet_count, 2)
        self.assertEqual(author.media_count, 2)
        self.assertEqual(author.known_bytes, 500)

        january = next(
            row for row in result.published_months if row.month.strftime("%Y-%m") == "2026-01"
        )
        baseline_january = next(
            (row for row in self.baseline.published_months if row.month.strftime("%Y-%m") == "2026-01"),
            None,
        )
        self.assertEqual(january.count - (baseline_january.count if baseline_january else 0), 2)
        self.assertEqual(
            january.media_count - (baseline_january.media_count if baseline_january else 0),
            2,
        )
        self.assertEqual(
            january.known_bytes - (baseline_january.known_bytes if baseline_january else 0),
            500,
        )
        march = next(row for row in result.imported_months if row.month.strftime("%Y-%m") == "2026-03")
        baseline_march = next(
            (row for row in self.baseline.imported_months if row.month.strftime("%Y-%m") == "2026-03"),
            None,
        )
        self.assertEqual(march.count - (baseline_march.count if baseline_march else 0), 2)

        self.assertEqual(
            result.organization.tagged_count - self.baseline.organization.tagged_count,
            1,
        )
        self.assertEqual(
            result.organization.collected_count - self.baseline.organization.collected_count,
            1,
        )
        self.assertEqual(
            result.organization.noted_count - self.baseline.organization.noted_count,
            1,
        )
        self.assertEqual(
            result.organization.organized_count - self.baseline.organization.organized_count,
            2,
        )
        self.assertEqual(
            result.completeness.text_count - self.baseline.completeness.text_count,
            2,
        )
        self.assertEqual(
            result.completeness.media_sha256_count
            - self.baseline.completeness.media_sha256_count,
            1,
        )

        # 同一 Tweet 出现在两个来源中，来源状态汇总仍按 Tweet 去重。
        self.assertEqual(
            result.discovery.discovered_count - self.baseline.discovery.discovered_count,
            2,
        )
        self.assertEqual(
            result.discovery.submitted_count - self.baseline.discovery.submitted_count,
            0,
        )
        self.assertEqual(
            result.discovery.verified_count - self.baseline.discovery.verified_count,
            2,
        )

    def test_insights_do_not_mutate_database_state(self) -> None:
        before = self.snapshot_rows()
        get_library_insights()
        after = self.snapshot_rows()

        self.assertEqual(after, before)

    def test_insights_rejects_an_accidental_write_inside_its_transaction(self) -> None:
        before = self.snapshot_rows()
        with (
            patch(
                "xarchiver.services.library.compile_query",
                return_value=("update tweets set updated_at = now()", {}),
            ),
            self.assertRaises(ReadOnlySqlTransaction),
        ):
            get_library_insights()

        self.assertEqual(self.snapshot_rows(), before)

    def snapshot_rows(self) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select tweet_id, download_status, updated_at
                    from tweets where tweet_id = any(%s) order by tweet_id
                    """,
                    (self.tweet_ids,),
                )
                tweet_rows = [dict(row) for row in cur.fetchall()]
                cur.execute(
                    """
                    select tweet_id, download_status, file_size, sha256, updated_at
                    from media_assets where tweet_id = any(%s) order by tweet_id, id
                    """,
                    (self.tweet_ids,),
                )
                media_rows = [dict(row) for row in cur.fetchall()]
        return tweet_rows, media_rows


if __name__ == "__main__":
    unittest.main()
