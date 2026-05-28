import unittest
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import patch

from xarchiver.db import connect
from xarchiver.services.queue import (
    get_run_detail,
    list_runs,
    list_runs_page,
    process_next_queued_run,
    retry_run,
    submit_archive_batch,
)


class QueueIntegrationTests(unittest.TestCase):
    tweet_ids = ["910000000000000001", "910000000000000002", "910000000000000003"]

    def setUp(self) -> None:
        self.cleanup_db()

    def tearDown(self) -> None:
        self.cleanup_db()

    def cleanup_db(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    delete from archive_runs
                    where trigger_type = 'manual_retry'
                      and exists (
                        select 1
                        from archive_run_items
                        where archive_run_id = archive_runs.id
                          and tweet_id = any(%s)
                      )
                    """,
                    (self.tweet_ids,),
                )
                cur.execute("delete from archive_runs where trigger_type like 'test_queue%'")
                cur.execute("delete from tweets where tweet_id = any(%s)", (self.tweet_ids,))
            conn.commit()

    def record(self, tweet_id: str) -> dict[str, str]:
        return {"url": f"https://x.com/queue/status/{tweet_id}"}

    def test_submission_deduplicates_input_and_skips_verified_tweet(self) -> None:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "insert into tweets (tweet_id, url, download_status) values (%s, %s, 'verified')",
                    (self.tweet_ids[0], self.record(self.tweet_ids[0])["url"]),
                )
            conn.commit()

        result = submit_archive_batch(
            [self.record(self.tweet_ids[0]), self.record(self.tweet_ids[0])],
            "test_queue_verified",
        )
        detail = get_run_detail(int(result["run_id"]))

        self.assertEqual(result["input"]["duplicate_input_count"], 1)
        self.assertEqual(result["tasks"]["skipped_verified_count"], 1)
        self.assertEqual(detail["items"][0]["status"], "skipped_verified")

    def test_second_submission_links_existing_pending_item(self) -> None:
        first = submit_archive_batch([self.record(self.tweet_ids[1])], "test_queue_first")
        second = submit_archive_batch([self.record(self.tweet_ids[1])], "test_queue_second")
        detail = get_run_detail(int(second["run_id"]))

        self.assertEqual(first["tasks"]["queued_count"], 1)
        self.assertEqual(second["tasks"]["linked_pending_count"], 1)
        self.assertEqual(detail["items"][0]["status"], "linked_pending")

    def test_second_submission_links_item_awaiting_automatic_retry(self) -> None:
        first = submit_archive_batch([self.record(self.tweet_ids[1])], "test_queue_retryable")
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "update archive_run_items set status = 'failed_retryable' where archive_run_id = %s",
                    (first["run_id"],),
                )
            conn.commit()

        second = submit_archive_batch([self.record(self.tweet_ids[1])], "test_queue_link_retryable")

        self.assertEqual(second["tasks"]["linked_pending_count"], 1)

    def test_submission_accepts_datetime_fields_in_raw_payload(self) -> None:
        result = submit_archive_batch(
            [
                {
                    "url": self.record(self.tweet_ids[0])["url"],
                    "published_at": datetime(2026, 5, 28, 1, 2, 3, tzinfo=UTC),
                    "collected_at": datetime(2026, 5, 28, 1, 3, 4, tzinfo=UTC),
                }
            ],
            "test_queue_datetime",
        )

        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "select input_payload from archive_run_items where archive_run_id = %s",
                    (result["run_id"],),
                )
                payload = cur.fetchone()["input_payload"]
        self.assertEqual(payload["published_at"], "2026-05-28T01:02:03+00:00")
        self.assertEqual(payload["collected_at"], "2026-05-28T01:03:04+00:00")

    def test_manual_retry_creates_new_run_for_terminal_failure(self) -> None:
        original = submit_archive_batch([self.record(self.tweet_ids[1])], "test_queue_terminal")
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "update archive_run_items set status = 'failed_permanent' where archive_run_id = %s",
                    (original["run_id"],),
                )
                cur.execute(
                    "update tweets set download_status = 'failed_permanent' where tweet_id = %s",
                    (self.tweet_ids[1],),
                )
            conn.commit()

        retried = retry_run(int(original["run_id"]))

        self.assertNotEqual(retried["run_id"], original["run_id"])
        self.assertEqual(retried["tasks"]["queued_count"], 1)

    def test_worker_processes_claimed_run_scope_and_completes_item(self) -> None:
        submitted = submit_archive_batch([self.record(self.tweet_ids[2])], "test_queue_worker")
        settings = SimpleNamespace(retry_limit=3, retry_backoff_minutes=15, queue_batch_size=20)
        pipeline = {
            "media": {
                "backfilled_media_count": 1,
                "verified_media_count": 1,
                "missing_media_count": 0,
                "corrupt_media_count": 0,
            }
        }
        with (
            patch("xarchiver.services.queue.process_tweet_scope", return_value=pipeline) as process,
            patch("xarchiver.services.queue.fetch_tweet_statuses", return_value={self.tweet_ids[2]: "verified"}),
        ):
            process_next_queued_run(settings)

        detail = get_run_detail(int(submitted["run_id"]))
        self.assertEqual(process.call_args.args[0], [self.tweet_ids[2]])
        self.assertEqual(detail["status"], "completed")
        self.assertEqual(detail["items"][0]["status"], "verified")

    def test_worker_respects_queue_batch_size(self) -> None:
        submitted = submit_archive_batch(
            [self.record(self.tweet_ids[0]), self.record(self.tweet_ids[1])],
            "test_queue_batch_size",
        )
        settings = SimpleNamespace(retry_limit=3, retry_backoff_minutes=15, queue_batch_size=1)
        pipeline = {
            "media": {
                "backfilled_media_count": 1,
                "verified_media_count": 1,
                "missing_media_count": 0,
                "corrupt_media_count": 0,
            }
        }
        with (
            patch("xarchiver.services.queue.process_tweet_scope", return_value=pipeline) as process,
            patch("xarchiver.services.queue.fetch_tweet_statuses", return_value={self.tweet_ids[0]: "verified"}),
        ):
            process_next_queued_run(settings)

        detail = get_run_detail(int(submitted["run_id"]))
        self.assertEqual(process.call_args.args[0], [self.tweet_ids[0]])
        self.assertEqual(detail["status"], "queued")

    def test_list_runs_filters_by_status_tweet_and_failed_items(self) -> None:
        matched = submit_archive_batch([self.record(self.tweet_ids[0])], "test_queue_filter_match")
        submit_archive_batch([self.record(self.tweet_ids[1])], "test_queue_filter_other")
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    update archive_run_items
                    set status = 'failed_permanent', error_category = 'invalid_url'
                    where archive_run_id = %s
                    """,
                    (matched["run_id"],),
                )
                cur.execute(
                    "update archive_runs set status = 'completed_with_failures' where id = %s",
                    (matched["run_id"],),
                )
            conn.commit()

        rows = list_runs(status="completed_with_failures", tweet_id=self.tweet_ids[0], failed_only=True)

        self.assertEqual([row["id"] for row in rows], [matched["run_id"]])

    def test_list_runs_page_supports_offset_and_total_count(self) -> None:
        first = submit_archive_batch([self.record(self.tweet_ids[0])], "test_queue_page_first")
        second = submit_archive_batch([self.record(self.tweet_ids[1])], "test_queue_page_second")

        page = list_runs_page(limit=1, offset=1, tweet_id="91000000000000000")

        self.assertEqual(page["count"], 1)
        self.assertEqual(page["total_count"], 2)
        self.assertEqual(page["limit"], 1)
        self.assertEqual(page["offset"], 1)
        self.assertEqual([row["id"] for row in page["rows"]], [first["run_id"]])
        self.assertNotEqual(first["run_id"], second["run_id"])
