import unittest
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import patch

from xarchiver.db import connect
from xarchiver.services.queue import (
    cancel_run_items,
    claim_next_items,
    get_run_detail,
    has_pending_download_work,
    has_runnable_download_work,
    heartbeat_archive_items,
    list_runs,
    list_runs_page,
    pause_run,
    process_next_queued_run,
    retry_run,
    should_use_download_archive,
    stop_run,
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
                cur.execute("delete from archive_sources where source_url like 'https://x.com/queue-source%'")
                cur.execute("delete from tweets where tweet_id = any(%s)", (self.tweet_ids,))
            conn.commit()

    def record(self, tweet_id: str) -> dict[str, str]:
        return {"url": f"https://x.com/queue/status/{tweet_id}"}

    def test_retry_work_ignores_stale_downloader_archives(self) -> None:
        self.assertFalse(should_use_download_archive("manual_retry", []))
        self.assertFalse(
            should_use_download_archive(
                "test_queue_retry",
                [{"retry_count": 1}],
            )
        )
        self.assertTrue(
            should_use_download_archive(
                "test_queue_initial",
                [{"retry_count": 0}],
            )
        )

    def create_source_id(self) -> int:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into archive_sources (source_type, source_url, author_username)
                    values ('user_media', 'https://x.com/queue-source/media', 'queue-source')
                    returning id
                    """
                )
                source_id = int(cur.fetchone()["id"])
            conn.commit()
        return source_id

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
                cur.execute(
                    "insert into failure_dispositions (tweet_id, reason) values (%s, 'other')",
                    (self.tweet_ids[1],),
                )
            conn.commit()

        retried = retry_run(int(original["run_id"]))

        self.assertNotEqual(retried["run_id"], original["run_id"])
        self.assertEqual(retried["tasks"]["queued_count"], 1)
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("select count(*)::int as count from failure_dispositions where tweet_id = %s", (self.tweet_ids[1],))
                self.assertEqual(int(cur.fetchone()["count"]), 0)
                cur.execute(
                    "select action, archive_run_id from failure_action_events where tweet_id = %s order by id desc limit 1",
                    (self.tweet_ids[1],),
                )
                event = cur.fetchone()
        self.assertEqual(event["action"], "retry")
        self.assertEqual(int(event["archive_run_id"]), int(retried["run_id"]))

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

    def test_claims_rotate_across_runnable_runs(self) -> None:
        first = submit_archive_batch(
            [self.record(self.tweet_ids[0]), self.record(self.tweet_ids[1])],
            "test_queue_fair_first",
        )
        second = submit_archive_batch(
            [self.record(self.tweet_ids[2])],
            "test_queue_fair_second",
        )

        first_claim = claim_next_items(retry_limit=3, batch_size=1, worker_id="fair-worker")
        second_claim = claim_next_items(retry_limit=3, batch_size=1, worker_id="fair-worker")

        self.assertEqual(first_claim[0]["archive_run_id"], first["run_id"])
        self.assertEqual(second_claim[0]["archive_run_id"], second["run_id"])

    def test_paused_items_are_pending_but_not_runnable(self) -> None:
        submitted = submit_archive_batch([self.record(self.tweet_ids[0])], "test_queue_paused_due")
        self.assertTrue(has_runnable_download_work())

        pause_run(int(submitted["run_id"]))

        self.assertTrue(has_pending_download_work())
        self.assertFalse(has_runnable_download_work())

    def test_worker_claims_multiple_items_up_to_queue_batch_size(self) -> None:
        submitted = submit_archive_batch(
            [self.record(self.tweet_ids[0]), self.record(self.tweet_ids[1])],
            "test_queue_batch_size_multi",
        )
        settings = SimpleNamespace(retry_limit=3, retry_backoff_minutes=15, queue_batch_size=2)
        pipeline = {
            "media": {
                "backfilled_media_count": 2,
                "verified_media_count": 2,
                "missing_media_count": 0,
                "corrupt_media_count": 0,
            }
        }
        with (
            patch("xarchiver.services.queue.process_tweet_scope", return_value=pipeline) as process,
            patch(
                "xarchiver.services.queue.fetch_tweet_statuses",
                return_value={self.tweet_ids[0]: "verified", self.tweet_ids[1]: "verified"},
            ),
        ):
            process_next_queued_run(settings)

        detail = get_run_detail(int(submitted["run_id"]))
        self.assertCountEqual(process.call_args.args[0], [self.tweet_ids[0], self.tweet_ids[1]])
        self.assertEqual(detail["status"], "completed")
        self.assertEqual([item["status"] for item in detail["items"]], ["verified", "verified"])

    def test_expired_processing_item_can_be_reclaimed_by_new_worker(self) -> None:
        submit_archive_batch([self.record(self.tweet_ids[2])], "test_queue_lease")
        first_claim = claim_next_items(3, batch_size=1, worker_id="worker-old")
        item_id = int(first_claim[0]["id"])
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    update archive_run_items
                    set lease_expires_at = now() - interval '1 second'
                    where id = %s
                    """,
                    (item_id,),
                )
            conn.commit()

        second_claim = claim_next_items(3, batch_size=1, worker_id="worker-new")

        self.assertEqual(int(second_claim[0]["id"]), item_id)
        self.assertEqual(second_claim[0]["worker_id"], "worker-new")
        self.assertFalse(heartbeat_archive_items([item_id], "worker-old"))

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

    def test_paused_source_run_blocks_new_source_download_run(self) -> None:
        source_id = self.create_source_id()
        first = submit_archive_batch([self.record(self.tweet_ids[0])], "test_queue_source_first", source_id=source_id)
        pause = pause_run(int(first["run_id"]))
        second = submit_archive_batch([self.record(self.tweet_ids[1])], "test_queue_source_second", source_id=source_id)
        detail = get_run_detail(int(second["run_id"]))

        self.assertEqual(pause["status"], "paused")
        self.assertEqual(second["status"], "blocked")
        self.assertEqual(second["blocked_by_run_id"], first["run_id"])
        self.assertEqual(second["tasks"]["blocked_count"], 1)
        self.assertEqual(detail["items"][0]["status"], "blocked")

    def test_stopping_source_run_releases_next_blocked_run(self) -> None:
        source_id = self.create_source_id()
        first = submit_archive_batch([self.record(self.tweet_ids[0])], "test_queue_source_stop_first", source_id=source_id)
        pause_run(int(first["run_id"]))
        second = submit_archive_batch([self.record(self.tweet_ids[1])], "test_queue_source_stop_second", source_id=source_id)

        stop_run(int(first["run_id"]))
        released = get_run_detail(int(second["run_id"]))

        self.assertEqual(released["status"], "queued")
        self.assertEqual(released["blocked_by_run_id"], None)
        self.assertEqual(released["items"][0]["status"], "pending")

    def test_cancel_pending_and_processing_items(self) -> None:
        submitted = submit_archive_batch(
            [self.record(self.tweet_ids[0]), self.record(self.tweet_ids[1])],
            "test_queue_cancel_items",
        )
        claimed = claim_next_items(3, batch_size=1, worker_id="worker-cancel")
        processing_id = str(claimed[0]["tweet_id"])
        pending_id = next(tweet_id for tweet_id in self.tweet_ids[:2] if tweet_id != processing_id)

        result = cancel_run_items(int(submitted["run_id"]), tweet_ids=[processing_id, pending_id])
        detail = get_run_detail(int(submitted["run_id"]))
        rows = {row["tweet_id"]: row for row in detail["items"]}

        self.assertEqual(result["affected_count"], 2)
        self.assertTrue(rows[processing_id]["cancel_requested"])
        self.assertEqual(rows[pending_id]["status"], "cancelled")
