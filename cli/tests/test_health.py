import unittest

from xarchiver.db import connect
from xarchiver.services.health import get_health_detail


class HealthServiceTests(unittest.TestCase):
    tweet_id = "920000000000000001"
    source_url = "https://x.com/test_health"

    def setUp(self) -> None:
        self.cleanup_db()

    def tearDown(self) -> None:
        self.cleanup_db()

    def cleanup_db(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("delete from archive_sources where source_url = %s", (self.source_url,))
                cur.execute("delete from archive_runs where trigger_type = 'test_health'")
                cur.execute("delete from tweets where tweet_id = %s", (self.tweet_id,))
            conn.commit()

    def test_recent_errors_include_target_paths_and_locator_ids(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "insert into tweets (tweet_id, url) values (%s, %s)",
                    (self.tweet_id, f"https://x.com/health/status/{self.tweet_id}"),
                )
                cur.execute(
                    """
                    insert into archive_runs (trigger_type, status)
                    values ('test_health', 'completed_with_failures')
                    returning id
                    """
                )
                run_id = int(cur.fetchone()["id"])
                cur.execute(
                    """
                    insert into archive_run_items (
                      archive_run_id, tweet_id, input_payload, status, error_category, error_message
                    )
                    values (%s, %s, '{}'::jsonb, 'failed_permanent', 'invalid_url', 'bad tweet')
                    returning id
                    """,
                    (run_id, self.tweet_id),
                )
                item_id = int(cur.fetchone()["id"])
                cur.execute(
                    """
                    insert into archive_sources (source_type, source_url)
                    values ('profile', %s)
                    returning id
                    """,
                    (self.source_url,),
                )
                source_id = int(cur.fetchone()["id"])
                cur.execute(
                    """
                    insert into source_scan_runs (
                      source_id, trigger_type, status, requested_limit, error_category, error_message
                    )
                    values (%s, 'manual_next', 'failed', 20, 'network_error', 'network failed')
                    returning id
                    """,
                    (source_id,),
                )
                scan_run_id = int(cur.fetchone()["id"])
            conn.commit()

        errors = get_health_detail()["recent_errors"]
        archive_error = next(error for error in errors if error["kind"] == "archive_item")
        source_error = next(error for error in errors if error["kind"] == "source_scan")

        self.assertEqual(archive_error["archive_run_id"], run_id)
        self.assertEqual(archive_error["archive_run_item_id"], item_id)
        self.assertEqual(archive_error["tweet_id"], self.tweet_id)
        self.assertEqual(archive_error["target_path"], f"/tweets/{self.tweet_id}")
        self.assertEqual(source_error["source_id"], source_id)
        self.assertEqual(source_error["source_scan_run_id"], scan_run_id)
        self.assertEqual(source_error["target_path"], f"/sources?sourceId={source_id}")

    def test_health_detail_includes_db_pool_stats(self) -> None:
        detail = get_health_detail()

        self.assertIn("db_pool", detail)
        self.assertEqual(set(detail["db_pool"]), {"active", "idle", "waiting", "min_size", "max_size"})


if __name__ == "__main__":
    unittest.main()
